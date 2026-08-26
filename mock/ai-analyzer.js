/**
 * AI 初步分析（Mock 規則引擎版）
 * 未成功（DIFF / FAIL）運行 → 基於 diff 明細與 HTTP 結果歸納結構化原因。
 *
 * 真實 AI 接入：config.ai.mode='remote' 且 apiBase 配置後，
 * 由 routes.js 的 remoteAnalyze() 轉發外部 AI API（見下方 DEFAULTS 說明）。
 * 前端只展示「僅供參考」的初步分析，判定仍以字段級比對為準。
 */

const DISCLAIMER = 'AI 初步分析僅供參考，請以字段級比對結果為準'

const escV = (v) => {
  const s = String(v ?? '')
  return s.length > 46 ? s.slice(0, 46) + '…' : s
}

/** 從原始報文中粗提取錯誤信息（JSON error/message / XML Error 標籤） */
function extractErrorSnippet(raw) {
  if (!raw) return null
  const s = String(raw)
  const m = s.match(/"?(?:error|errorMessage|message|reason|description|errMsg)"?\s*[:=]\s*"([^"]+)"/i)
  if (m) return m[1]
  const x = s.match(/<(?:Error|Fault|Reason|Description)[^>]*>([^<]+)<\//i)
  if (x) return x[1].trim()
  return s.slice(0, 120)
}

/** DIFF 模式：基於字段級比對明細歸納 */
function analyzeDiff(run, c) {
  const items = run.diff?.items || []
  const add = items.filter((i) => i.kind === 'added')
  const del = items.filter((i) => i.kind === 'deleted')
  const mod = items.filter((i) => i.kind === 'modified')
  const risk = items.filter((i) => i.precisionRisk)
  const path = (i) => i.path.join('.')

  const reasons = []
  // 結構性：新增/缺失欄位（疑似介面版本或欄位映射問題）
  if (add.length) reasons.push({ level: 'warn', text: `微服務系統較主機多出欄位：${add.slice(0, 4).map(path).join('、')}${add.length > 4 ? ` 等 ${add.length} 個` : ''}（可能為介面升級或欄位映射差異）` })
  if (del.length) reasons.push({ level: 'warn', text: `微服務系統缺少主機欄位：${del.slice(0, 4).map(path).join('、')}${del.length > 4 ? ` 等 ${del.length} 個` : ''}（需確認欄位是否被下線或映射缺失）` })
  // 資料性：值不一致
  for (const i of mod.slice(0, 5)) {
    const tv = path(i)
    reasons.push({ level: i.suspicion === 'HIGH' ? 'error' : 'info', text: `欄位 ${tv} 值不一致（主機「${escV(i.hostValue)}」vs 微服務「${escV(i.newValue)}」）` })
  }
  if (mod.length > 5) reasons.push({ level: 'info', text: `另有 ${mod.length - 5} 處修改欄位，詳見下方字段級比對` })
  // 長數字精度風險
  if (risk.length) reasons.push({ level: 'warn', text: `長數字欄位 ${risk.slice(0, 3).map(path).join('、')} 存在精度風險，建議核對數據庫精度設定` })
  // HTTP 異常附加
  for (const side of ['hostResult', 'newResult']) {
    const r = run[side]
    if (r && r.httpStatus && (r.httpStatus < 200 || r.httpStatus >= 300)) {
      reasons.push({ level: 'error', text: `${side === 'hostResult' ? '主機' : '微服務系統'}返回 HTTP ${r.httpStatus}，請檢查接口可用性與鑒權` })
    }
  }

  const total = items.length
  const summary = total === 0
    ? '兩側報文結構一致，但執行被判為未通過（詳見執行過程）'
    : `兩側響應存在 ${total} 處字段差異（${add.length} 增 / ${del.length} 刪 / ${mod.length} 改），${add.length + del.length ? '以結構性差異為主' : '以資料值差異為主'}`
  return {
    summary,
    reasons: reasons.slice(0, 8),
    confidence: total <= 3 ? '高' : total <= 10 ? '中' : '低',
    disclaimer: DISCLAIMER,
    model: '規則引擎（mock）',
  }
}

/** HTTP 模式：基於狀態碼與響應體歸納 */
function analyzeHttp(run, c) {
  const res = run.newResult
  const status = res?.httpStatus ?? run.httpStatus
  const reasons = []
  if (status != null && (status < 200 || status >= 300)) {
    reasons.push({ level: 'error', text: `微服務系統返回 HTTP ${status}（${status >= 500 ? '疑似服務端異常' : status === 404 ? '接口路徑或方法不存在' : status === 401 || status === 403 ? '鑒權失敗，請檢查 API-Key 與權限' : '請求被拒絕'}）` })
  } else if (status != null) {
    reasons.push({ level: 'warn', text: `HTTP ${status} 雖為 2xx，但執行被判失敗，請核對業務結果與響應體` })
  }
  const snip = extractErrorSnippet(res?.rawBody)
  if (snip) reasons.push({ level: 'info', text: `響應錯誤信息：${escV(snip)}` })
  for (const st of run.steps || []) {
    if (st.status === 'fail') reasons.push({ level: 'error', text: `步驟「${st.name}」失敗：${st.detail || '無詳情'}` })
    else if (st.status === 'warn') reasons.push({ level: 'warn', text: `步驟「${st.name}」異常：${st.detail || '無詳情'}` })
  }
  return {
    summary: status != null && status >= 400
      ? `微服務系統接口調用失敗（HTTP ${status}）`
      : '執行未通過，請結合 HTTP 狀態與響應體定位原因',
    reasons: reasons.slice(0, 8),
    confidence: reasons.length ? '中' : '低',
    disclaimer: DISCLAIMER,
    model: '規則引擎（mock）',
  }
}

export function analyzeFailure(run, c) {
  if (!run || run.verdict === 'PASS') {
    return { summary: '執行通過，無需分析', reasons: [], confidence: '高', disclaimer: DISCLAIMER, model: '規則引擎（mock）' }
  }
  return run.diff ? analyzeDiff(run, c) : analyzeHttp(run, c)
}
