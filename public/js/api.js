/**
 * API 客戶端：統一一點切換真實後端（window.APP_CONFIG?.apiBase）
 * 響應契約：{ code:0, message:'ok', data }；非 0 code 一律拋出 Error(message)
 */

const BASE = (() => {
  try {
    return window.APP_CONFIG?.apiBase || ''
  } catch {
    return ''
  }
})()

/**
 * @param {string} path 例如 '/api/cases'
 * @param {object} [opts] { method, body, params }
 * @returns {Promise<any>} data 欄位
 */
export async function api(path, { method = 'GET', body, params, raw = false } = {}) {
  const qs = params ? '?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null))
  ).toString() : ''
  const res = await fetch(BASE + path + qs, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (raw) return res
  let j
  try {
    j = await res.json()
  } catch {
    throw new Error(`伺服器回應無法解析（HTTP ${res.status}）`)
  }
  if (!j || typeof j.code !== 'number') throw new Error(`非預期回應結構（HTTP ${res.status}）`)
  if (j.code !== 0) throw new Error(j.message || `請求失敗（${j.code}）`)
  return j.data
}

export const get = (path, params) => api(path, { params })
export const post = (path, body) => api(path, { method: 'POST', body })
export const put = (path, body) => api(path, { method: 'PUT', body })
export const del = (path) => api(path, { method: 'DELETE' })
