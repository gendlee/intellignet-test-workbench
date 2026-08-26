/**
 * 比較規則集：值比較、時間/數值/布爾正規化、合理性分級、機器理由文案
 *
 * 設計原則：永不靜默吞掉差異——「僅表示方式不同」的差異仍會輸出為 FORMAT 低可疑
 * 條目（附理由），只是不影響 PASS/FAIL 判決。
 */

export const DEFAULT_RULES = {
  trim: true, // 字串 trim 後比較
  typeCoerce: true, // 字串數字 ↔ number、字串布爾 ↔ boolean
  numeric: 'strict', // 'strict' 規範化數字字串比較（防浮點）| 'float' parseFloat + 相對容差
  numericTolerance: 1e-9, // float 模式的相對容差
  longNumberGuard: 15, // 有效位數 > 15 強制字串比較並標記「精度風險」
  timeNormalize: true, // 多種時間格式歸一為 epoch 比較
  collapseSingleArray: true, // 長度 1 陣列與單一值等價（XML↔JSON 對齊）
  attrMerge: true, // XML 屬性鍵 '@a' 與 JSON 鍵 'a' 等價
  namespaceInsensitive: true, // 忽略命名空間前綴
  emptyEqualsNull: false, // null == 空串 == 缺失 視為等價
  ignoreFields: [], // 精確欄位名（任何層級），完全忽略
  dynamicRegex: [], // 動態欄位正則（timestamp/traceId/nonce 等），完全忽略
  wrapIgnoreKeys: [], // 包裝鍵（如 code/msg/status/requestId），不參與 diff
  arrayMatchMode: 'index', // 'index' | 'key'
  arrayMatchKeys: {}, // key 模式：{ 'items.path': 'seqNo' }
}

/** ---------- 正規化工具 ---------- */

/** 乾淨數字的規範化字串；非乾淨數字（如含前導零的帳號）回傳 null */
export function canonicalNumber(str) {
  if (typeof str === 'number') {
    if (!Number.isFinite(str)) return null
    return str === 0 ? '0' : String(str)
  }
  let s = str.trim()
  if (/^-?\d+$/.test(s)) {
    // 前導零（"007"）→ 非乾淨數字，防帳號類欄位被誤合併
    if (/^-?0\d/.test(s) && !/^-?0+$/.test(s)) return null
    s = s.replace(/^(-?)0+(?=\d)/, '$1')
    return s
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    const [int, frac] = s.split('.')
    if (int.replace('-', '') !== '' && /^-?0\d/.test(int)) return null
    const fracTrim = frac.replace(/0+$/, '')
    const sign = int.startsWith('-') ? '-' : ''
    const intPart = int.replace(/^[+-]?0+/, '') || '0'
    return fracTrim ? `${sign}${intPart}.${fracTrim}` : `${sign}${intPart}`
  }
  return null
}

/** 時間正規化：支援 ISO8601、yyyy-MM-dd HH:mm:ss、yyyy/MM/dd HH:mm:ss、yyyyMMddHHmmss、yyyyMMdd、epoch 秒/毫秒 */
export function parseTime(str) {
  const s = str.trim()
  if (!s) return null
  // epoch
  if (/^\d{10}$/.test(s)) return { epoch: Number(s) * 1000, kind: 'epoch-s' }
  if (/^\d{13}$/.test(s)) return { epoch: Number(s), kind: 'epoch-ms' }
  // ISO8601（含時區偏移）
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) {
    const t = Date.parse(s.replace(' ', 'T'))
    if (!Number.isNaN(t)) return { epoch: t, kind: 'iso' }
    return null
  }
  // yyyyMMddHHmmss / yyyyMMdd
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    return { epoch: t, kind: 'compact-dt' }
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) {
    return { epoch: Date.UTC(+m[1], +m[2] - 1, +m[3]), kind: 'compact-d' }
  }
  // yyyy-MM-dd
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    return { epoch: Date.UTC(+m[1], +m[2] - 1, +m[3]), kind: 'date' }
  }
  return null
}

/** ---------- 值比較 ---------- */

const BOOL_MAP = { true: true, false: false }

/**
 * 比較兩個 leaf，回傳 { equal, plausibility: 'FORMAT'|'DATA', precisionRisk, reason }
 * - equal=true 且 plausibility='FORMAT'：語意相等但表示方式不同（資訊性差異）
 * - equal=false 且 plausibility='DATA'：實質不同
 */
export function compareValues(h, n, rules = DEFAULT_RULES) {
  const hr = h.raw.trim()
  const nr = n.raw.trim()
  const hType = h.type
  const nType = n.type

  // 空值等價
  if (rules.emptyEqualsNull) {
    const hEmpty = hType === 'null' || hr === ''
    const nEmpty = nType === 'null' || nr === ''
    if (hEmpty && nEmpty) return { equal: true, plausibility: 'FORMAT' }
  }

  // 字串完全相等
  if (hr === nr) return { equal: true }

  // 時間歸一（兩端都解析成功才啟用）
  if (rules.timeNormalize) {
    const ht = parseTime(hr)
    const nt = parseTime(nr)
    if (ht && nt) {
      if (ht.epoch === nt.epoch) {
        return {
          equal: true,
          plausibility: 'FORMAT',
          informational: true,
          reason: `僅時間表示方式不同：${h.raw} vs ${n.raw}`,
        }
      }
      return { equal: false, plausibility: 'DATA', reason: `時間值不同：${h.raw} vs ${n.raw}` }
    }
  }

  // 數字比較（含字串數字 ↔ number 的 typeCoerce）
  const hNum = canonicalNumber(hr)
  const nNum = canonicalNumber(nr)
  if (hNum !== null && nNum !== null) {
    // 長數字精度保護：有效位數超過門檻 → 強制字串比較
    const hSig = hr.replace(/[^0-9]/g, '').replace(/^0+/, '').length
    const nSig = nr.replace(/[^0-9]/g, '').replace(/^0+/, '').length
    if (Math.max(hSig, nSig) > rules.longNumberGuard) {
      return {
        equal: false,
        plausibility: 'DATA',
        precisionRisk: true,
        reason: `長數字超出精度範圍（>${rules.longNumberGuard} 位），按字串比較：${h.raw} vs ${n.raw}`,
      }
    }
    let equal = false
    if (rules.numeric === 'strict') {
      equal = hNum === nNum
    } else {
      const a = parseFloat(hNum)
      const b = parseFloat(nNum)
      equal = a === b || Math.abs(a - b) <= rules.numericTolerance * Math.max(1, Math.abs(a), Math.abs(b))
    }
    if (equal) {
      return {
        equal: true,
        plausibility: 'FORMAT',
        informational: true,
        reason: `數值表示方式不同：${h.raw} vs ${n.raw}`,
      }
    }
    return { equal: false, plausibility: 'DATA', reason: `數值不同：${h.raw} vs ${n.raw}` }
  }

  // 布爾比較
  const hb = hType === 'boolean' ? h.raw === 'true' : BOOL_MAP[hr] ?? null
  const nb = nType === 'boolean' ? n.raw === 'true' : BOOL_MAP[nr] ?? null
  if (rules.typeCoerce && hb !== null && nb !== null) {
    if (hb === nb) {
      return {
        equal: true,
        plausibility: 'FORMAT',
        informational: true,
        reason: `布爾表示方式不同：${h.raw} vs ${n.raw}`,
      }
    }
    return { equal: false, plausibility: 'DATA', reason: `布爾值不同：${h.raw} vs ${n.raw}` }
  }

  // 其他 → 實質不同
  return { equal: false, plausibility: 'DATA', reason: `值不同：${h.raw} vs ${n.raw}` }
}

/** ---------- 合理性分級 ---------- */

/**
 * @param {'FORMAT'|'STRUCTURAL'|'DATA'} plausibility
 * @param {'STATELESS'|'STATEFUL'} stateType
 * @returns 'low' | 'medium' | 'high'
 */
export function suspicionOf(plausibility, stateType = 'STATELESS') {
  if (plausibility === 'FORMAT') return 'low'
  if (plausibility === 'STRUCTURAL') return 'medium'
  // DATA：無狀態接口同輸入應同輸出 → 高可疑；有狀態接口可能源於前置狀態 → 中可疑
  return stateType === 'STATEFUL' ? 'medium' : 'high'
}

export function suspicionReason(item, stateType) {
  if (item.plausibility === 'FORMAT') return '僅表示方式不同，建議確認遷移後格式是否可接受'
  if (item.plausibility === 'STRUCTURAL') return '字段結構變化，請確認遷移後接口契約是否調整'
  if (stateType === 'STATEFUL') {
    return '接口有狀態，差異可能源於前置狀態（餘額/流水/會話），建議核對前置條件後重跑驗證'
  }
  return '無狀態接口同輸入應同輸出，建議復核報文與數據'
}
