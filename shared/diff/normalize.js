/**
 * 統一中間表示（UIR）與拍平
 *
 * XML 與 JSON 都轉換為同一棵樹：
 *   node = { kind: 'obj',  children: Map<key, node> }
 *        | { kind: 'arr',  items: node[] }
 *        | { kind: 'leaf', type: 'string'|'number'|'boolean'|'null', raw }
 *
 * XML 側約定：
 *   - 屬性 → 鍵 '@attrName'（與 xml-js 慣例一致）
 *   - 文字 → 鍵 '#text'（trim 後為空的純空白文字節點直接丟棄）
 *   - CDATA 併入文字
 *   - 重複兄弟標籤 → 陣列；單一標籤 → 單一物件（陣列長度差異由 comparators 的
 *     collapseSingleArray 規則對稱處理，避免 XML 單元素 vs JSON 單元素陣列的假差異）
 *   - 命名空間前綴保留在鍵名中，比較階段可忽略（namespaceInsensitive）
 *
 * 拍平：樹 → Map<pathKey, Leaf>，pathKey 以 '|' 分隔路徑段（段內 '\' 與 '|' 轉義）。
 */

import { parseXML } from './xml-parser.js'

/** ---------- 路徑鍵編碼 ---------- */

export function encodeSeg(seg) {
  return String(seg).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

export function decodeSeg(seg) {
  return seg.replace(/\\\|/g, '|').replace(/\\\\/g, '\\')
}

export function encodePath(segs) {
  return segs.map(encodeSeg).join('|')
}

/** ---------- XML → 樹 ---------- */

/**
 * 瀏覽器端 DOMParser 兜底（Node 無此 API；僅在手寫解析器失敗時使用）
 */
function fallbackDOMParser(xmlText) {
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) return null
  const conv = (node) => {
    if (node.nodeType === 3 || node.nodeType === 4) return { text: node.nodeValue || '' }
    const el = {
      tag: node.nodeName,
      attrs: {},
      children: [],
      selfClosing: node.children.length === 0,
    }
    for (const a of node.attributes || []) el.attrs[a.name] = a.value
    for (const c of node.childNodes) el.children.push(conv(c))
    return el
  }
  const root = doc.documentElement
  if (!root) return null
  return conv(root)
}

/**
 * @param {string} xmlText
 * @param {object} [opts] { stripNsPrefix: boolean } 鍵名是否去除命名空間前綴（預設 true）
 * @returns 統一樹（根節點即根元素轉換結果）
 */
export function xmlToTree(xmlText, { stripNsPrefix = true } = {}) {
  let dom
  try {
    dom = parseXML(xmlText)
  } catch (e) {
    const fallback = fallbackDOMParser(xmlText)
    if (!fallback) throw e
    dom = fallback
  }
  const strip = (tag) => (stripNsPrefix && tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag)
  return convertElement(dom, strip, true)
}

function leafOf(v) {
  if (v === null || v === undefined) return { kind: 'leaf', type: 'null', raw: '' }
  const t = typeof v
  if (t === 'number') return { kind: 'leaf', type: 'number', raw: String(v) }
  if (t === 'boolean') return { kind: 'leaf', type: 'boolean', raw: String(v) }
  return { kind: 'leaf', type: 'string', raw: String(v) }
}

function convertElement(el, strip, isRoot = false) {
  const obj = {}
  for (const [k, v] of Object.entries(el.attrs || {})) {
    // xmlns 屬性是命名空間宣告而非資料，直接丟棄
    if (k === 'xmlns' || k.startsWith('xmlns:')) continue
    obj[`@${strip(k)}`] = leafOf(v)
  }

  // 純文字元素（無子元素、無屬性）→ 直接 leaf
  const elChildren = el.children.filter((c) => 'tag' in c)
  const textParts = el.children.filter((c) => 'text' in c && c.text.trim())
  if (elChildren.length === 0) {
    const text = textParts.map((c) => c.text).join('').trim()
    if (Object.keys(obj).length === 0) return leafOf(text)
    if (text) obj['#text'] = leafOf(text)
    return { kind: 'obj', children: new Map(Object.entries(obj)) }
  }

  // 子元素分組：重複標籤 → 陣列；單一 → 單一
  const grouped = new Map()
  for (const c of elChildren) {
    const key = strip(c.tag)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(convertElement(c, strip))
  }
  for (const [key, items] of grouped) {
    obj[key] = items.length === 1 ? items[0] : { kind: 'arr', items }
  }
  const text = textParts.map((c) => c.text).join('').trim()
  if (text) obj['#text'] = leafOf(text)

  // 包裝層收斂：obj 恰好只有一個子鍵且為陣列 → 直接收斂為該陣列
  // （XML 列表容器慣例：<Transactions><Transaction>×2 → JSON 直接是陣列；
  //   根元素除外，否則根標籤會消失）
  const entries = Object.entries(obj)
  if (!isRoot && entries.length === 1 && entries[0][1].kind === 'arr') {
    return entries[0][1]
  }
  return { kind: 'obj', children: new Map(entries) }
}

/** ---------- JSON → 樹 ---------- */

export function jsonToTree(jsonText) {
  let value
  try {
    value = JSON.parse(jsonText)
  } catch (e) {
    throw new Error(`JSON 解析失敗：${e.message}`)
  }
  return convertJson(value)
}

function convertJson(v) {
  if (v === null || v === undefined) return { kind: 'leaf', type: 'null', raw: '' }
  if (Array.isArray(v)) return { kind: 'arr', items: v.map(convertJson) }
  if (typeof v === 'object') {
    const m = new Map()
    for (const [k, val] of Object.entries(v)) m.set(k, convertJson(val))
    return { kind: 'obj', children: m }
  }
  return leafOf(v)
}

/** ---------- 拍平 ---------- */

/**
 * 樹 → Map<pathKey, Leaf>。空 segs 起拍（根節點不在路徑中）。
 * collapseSingle 為 true 時，長度 1 的陣列視同其唯一元素（對稱規則，XML/JSON 皆適用）。
 */
export function flatten(tree, { collapseSingle = true } = {}) {
  const map = new Map()
  const walk = (node, segs) => {
    if (node.kind === 'leaf') {
      map.set(encodePath(segs), node)
      return
    }
    if (node.kind === 'arr') {
      if (collapseSingle && node.items.length === 1) {
        walk(node.items[0], segs)
        return
      }
      node.items.forEach((it, idx) => walk(it, [...segs, String(idx)]))
      return
    }
    node.children.forEach((v, k) => walk(v, [...segs, k]))
  }
  walk(tree, [])
  return map
}

/** 拍平時展開陣列對齊（arrayMatchMode='key' 用）：主鍵對齊後，多餘元素保留原始索引 */
export function flattenNoCollapse(tree) {
  return flatten(tree, { collapseSingle: false })
}

/** 顯示用路徑：data.items[0].amount */
export function displayPath(segs) {
  let out = ''
  for (const s of segs) {
    out += /^\d+$/.test(s) ? `[${s}]` : (out ? '.' : '') + s
  }
  return out
}
