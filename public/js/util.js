/** 通用工具：HTML 轉義（XSS 防護）、時間/數字格式化、小型 DOM 輔助 */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/** ISO 時間 → 'YYYY-MM-DD HH:mm'（本地時區） */
export function fmtTime(iso, withSec = false) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return withSec ? `${base}:${p(d.getSeconds())}` : base
}

export function fmtAgo(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '剛剛'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小時前`
  if (diff < 86400_000 * 30) return `${Math.floor(diff / 86400_000)} 天前`
  return fmtTime(iso)
}

export function debounce(fn, ms = 300) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/** verdict → 徽標 HTML（PASS/FAIL/DIFF） */
export function verdictBadge(v) {
  const map = {
    PASS: ['badge-ok', '通過'],
    FAIL: ['badge-danger', '失敗'],
    DIFF: ['badge-danger', '有差異'],
    RUNNING: ['badge-info', '執行中'],
  }
  const [cls, label] = map[v] || ['badge-neutral', v || '—']
  return `<span class="badge ${cls}">${label}</span>`
}

/** 可疑度徽標（low/medium/high） */
export function suspicionBadge(s) {
  const map = { low: ['badge-susp-low', '低可疑'], medium: ['badge-susp-medium', '中可疑'], high: ['badge-susp-high', '高可疑'] }
  const [cls, label] = map[s] || ['badge-neutral', s || '—']
  return `<span class="badge badge-susp ${cls}">${label}</span>`
}

export const kindLabel = { added: '新增', deleted: '刪除', modified: '修改' }
export const plausibilityLabel = { FORMAT: '格式性', STRUCTURAL: '結構性', DATA: '資料性' }
export const stateTypeLabel = { STATELESS: '無狀態', STATEFUL: '有狀態' }
export const statusLabel = { DRAFT: '草稿', PENDING: '待審核', APPROVED: '已通過', REJECTED: '已駁回' }
export const CASE_TYPES = ['Regular', 'ECC', 'ExceptionHandling', 'Boundaries']
export const TEST_TYPE_ENVS = { SIT: ['SIT1', 'SIT3'], UAT: ['USMK', 'USMF'] }
/** 測試類型顯示：SIT（SIT1 · SIT3）/ UAT（USMK · USMF） */
export function testTypeLabel(t) {
  const envs = TEST_TYPE_ENVS[t] || []
  return envs.length ? `${t}（${envs.join(' · ')}）` : String(t || '—')
}

export function statusBadge(s) {
  const map = {
    DRAFT: ['badge-neutral', '草稿'],
    PENDING: ['badge-warn', '待審核'],
    APPROVED: ['badge-ok', '已通過'],
    REJECTED: ['badge-danger', '已駁回'],
  }
  const [cls, label] = map[s] || ['badge-neutral', s || '—']
  return `<span class="badge ${cls}">${label}</span>`
}

/** 動態建立元素（文字一律 textContent，防 XSS） */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (k === 'text') node.textContent = v
    else if (k === 'value' && 'value' in node) node.value = v
    else if (k === 'innerHTML') node.innerHTML = v
    else if (typeof v === 'boolean') node[k] = v
    else node.setAttribute(k, v)
  }
  for (const c of [].concat(children)) {
    if (c == null) continue
    node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return node
}

/** 語義 diff：把 text 中與另一側不同的子串包成 <span> 高亮 */
export function semanticDiff(text, other) {
  const a = String(text ?? '')
  const b = String(other ?? '')
  // 行級 LCS（字元級太貴；行級對報文足夠直觀）
  const linesA = a.split('\n')
  const linesB = b.split('\n')
  const lcs = longestCommonSeq(linesA, linesB)
  const set = new Set(lcs)
  return linesA.map((line) =>
    set.has(line) ? esc(line) : `<span class="sd-del">${esc(line)}</span>`
  ).join('\n')
}

/** 密鑰脫敏：保留前 4 字符，其餘以 • 掩蓋；過短或空值全掩蓋 */
export function maskSecret(v) {
  if (!v) return ''
  const s = String(v)
  return s.length <= 6 ? '••••••' : s.slice(0, 4) + '••••••'
}

const SECRET_HEADER_RE = /key|secret|token|passwd|password|apikey/i

/** 判斷請求頭是否為敏感欄位（顯式 secret 標記或名稱含 key/secret/token/password） */
export function isSecretHeader(h) {
  return !!(h && (h.secret === true || SECRET_HEADER_RE.test(String(h.name || ''))))
}

function longestCommonSeq(a, b) {
  const n = a.length, m = b.length
  if (!n || !m) return []
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(a[i]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return out
}
