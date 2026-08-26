/**
 * diff 主入口：compare(hostText, newText, opts) → DiffResult
 *
 * 流程：解析（XML/JSON）→ 統一樹 → 拍平 Map<pathKey, Leaf>
 *     → 過濾（wrapIgnoreKeys / ignoreFields / dynamicRegex / attrMerge）
 *     → 陣列對齊（key 模式）→ 逐鍵比較 → 合理性分級 → DiffResult
 *
 * 本模組與 mock/generators.js 共用，保證「執行結果口徑 = 前端展示口徑」。
 */

import { xmlToTree, jsonToTree, flatten } from './normalize.js'
import { compareValues, suspicionOf, suspicionReason, DEFAULT_RULES } from './comparators.js'

/**
 * 陣列主鍵對齊（arrayMatchMode='key'）：把 new 側陣列重排，使主鍵相同的元素與
 * host 側索引對齊（剩餘元素保持原序；host 有而 new 無的位置以空物件佔位）。
 * 遞迴深入：obj 鍵需兩側都存在才深入；arr 按對齊後的索引深入。
 */
export function alignArraysByKey(hostTree, newTree, matchKeys, prefix = []) {
  const pathStr = prefix.join('.')
  const matchKey = matchKeys[pathStr]
  if (matchKey && hostTree?.kind === 'arr' && newTree?.kind === 'arr') {
    const indexByKey = new Map()
    hostTree.items.forEach((it, i) => {
      const k = it.kind === 'obj' ? it.children.get(matchKey)?.raw : undefined
      if (k !== undefined) indexByKey.set(String(k), i)
    })
    const reordered = new Array(hostTree.items.length)
    const extra = []
    for (const it of newTree.items) {
      const k = it.kind === 'obj' ? it.children.get(matchKey)?.raw : undefined
      const i = k !== undefined ? indexByKey.get(String(k)) : undefined
      if (i !== undefined && reordered[i] === undefined) reordered[i] = it
      else extra.push(it)
    }
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i] === undefined) reordered[i] = { kind: 'obj', children: new Map() }
    }
    newTree.items = reordered.concat(extra)
  }
  if (hostTree?.kind === 'obj' && newTree?.kind === 'obj') {
    for (const [k, hv] of hostTree.children) {
      if (newTree.children.has(k)) {
        alignArraysByKey(hv, newTree.children.get(k), matchKeys, [...prefix, k])
      }
    }
  } else if (hostTree?.kind === 'arr' && newTree?.kind === 'arr') {
    hostTree.items.forEach((hv, i) => {
      if (newTree.items[i]) alignArraysByKey(hv, newTree.items[i], matchKeys, [...prefix, String(i)])
    })
  }
}

/** 過濾 + 屬性鍵合併（XML '@a' ↔ JSON 'a'） */
function filterMap(map, rules) {
  const out = new Map()
  for (const [pathKey, leaf] of map) {
    const segs = pathKey.split('|')
    const rawSegs = segs.map((s) => s.replace(/\\\|/g, '|'))
    const last = rawSegs[rawSegs.length - 1]

    // 包裝鍵（第一段，如 code/msg/status/requestId）：不參與 diff
    if (rules.wrapIgnoreKeys.includes(rawSegs[0])) continue
    // 精確忽略欄位
    if (rules.ignoreFields.includes(last)) continue
    // 動態欄位正則
    let ignored = false
    for (const re of rules.dynamicRegex) {
      try {
        if (new RegExp(re).test(last)) {
          ignored = true
          break
        }
      } catch {
        /* 非法正則忽略 */
      }
    }
    if (ignored) continue

    // 屬性鍵合併：'@a' → 'a'（與 JSON 的 'a' 對齊）
    if (rules.attrMerge && last.startsWith('@')) {
      segs[segs.length - 1] = last.slice(1)
      out.set(segs.join('|'), leaf)
    } else {
      out.set(pathKey, leaf)
    }
  }
  return out
}

function buildResult(fHost, fNew, rules, stateType, opts) {
  const items = []
  const addItem = (segments, kind, detail) => {
    const plausibility = detail.plausibility || (kind === 'modified' ? 'DATA' : 'STRUCTURAL')
    const suspicion = detail.suspicion || suspicionOf(plausibility, stateType)
    items.push({
      path: segments,
      kind,
      hostValue: detail.hostValue ?? null,
      newValue: detail.newValue ?? null,
      plausibility,
      suspicion,
      precisionRisk: !!detail.precisionRisk,
      reason: detail.reason || suspicionReason({ plausibility }, stateType),
    })
  }

  const all = new Set([...fHost.keys(), ...fNew.keys()])
  for (const k of all) {
    const h = fHost.get(k)
    const n = fNew.get(k)
    const segs = k.split('|').map((s) => s.replace(/\\\|/g, '|'))
    if (h && n) {
      const r = compareValues(h, n, rules)
      // 實質差異（!equal）或資訊性表示差異（informational，如時間格式）都要輸出，
      // 永不靜默吞掉差異——僅表示不同的條目為 FORMAT 低可疑，不影響 PASS/FAIL 判決
      if (!r.equal || r.informational) {
        addItem(segs, 'modified', { hostValue: h.raw, newValue: n.raw, ...r })
      }
    } else if (h) {
      addItem(segs, 'deleted', { hostValue: h.raw })
    } else {
      addItem(segs, 'added', { newValue: n.raw })
    }
  }

  items.sort((a, b) => a.path.join('|').localeCompare(b.path.join('|')))

  const summary = {
    total: items.length,
    added: items.filter((i) => i.kind === 'added').length,
    deleted: items.filter((i) => i.kind === 'deleted').length,
    modified: items.filter((i) => i.kind === 'modified').length,
    low: items.filter((i) => i.suspicion === 'low').length,
    medium: items.filter((i) => i.suspicion === 'medium').length,
    high: items.filter((i) => i.suspicion === 'high').length,
  }

  // 判決：無差異 → PASS；存在高可疑 → FAIL；其餘（僅低/中可疑）→ DIFF
  const verdict = summary.total === 0 ? 'PASS' : summary.high > 0 ? 'FAIL' : 'DIFF'

  return {
    summary,
    items,
    verdict,
    stateType,
    meta: opts.extraMeta || {},
  }
}

/**
 * 主入口
 * @param {string} hostText 主機系統輸出（XML）
 * @param {string} newText  微服務系統輸出（JSON）
 * @param {object} [opts]
 *   rules:      比較規則（合併 DEFAULT_RULES）
 *   stateType:  'STATELESS' | 'STATEFUL'
 *   extraMeta:  { stateNote, caseName, txnCode } 附加到結果
 * @returns DiffResult { summary, items, verdict, stateType, meta }
 */
export function compare(hostText, newText, opts = {}) {
  const rules = { ...DEFAULT_RULES, ...(opts.rules || {}) }
  const stateType = opts.stateType === 'STATEFUL' ? 'STATEFUL' : 'STATELESS'

  let hostTree, newTree
  try {
    hostTree = xmlToTree(hostText, { stripNsPrefix: rules.namespaceInsensitive })
  } catch (e) {
    throw new Error(`主機報文解析失敗：${e.message}`)
  }
  try {
    newTree = jsonToTree(newText)
  } catch (e) {
    throw new Error(`微服務系統報文解析失敗：${e.message}`)
  }

  if (rules.arrayMatchMode === 'key') {
    alignArraysByKey(hostTree, newTree, rules.arrayMatchKeys || {})
  }

  const hostMap = flatten(hostTree, { collapseSingle: rules.collapseSingleArray })
  const newMap = flatten(newTree, { collapseSingle: rules.collapseSingleArray })

  const fHost = filterMap(hostMap, rules)
  const fNew = filterMap(newMap, rules)
  return buildResult(fHost, fNew, rules, stateType, opts)
}

export { DEFAULT_RULES }
