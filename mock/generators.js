/**
 * Mock 執行器：AI 生成轉換、單條/批量執行模擬、壓測曲線生成
 *
 * 契約即 API：POST /api/cases/ai-generate 的回傳結構就是前端介面，
 * 後續接真實 AI 後端時僅需替換本檔實作，前端零改動。
 */

import { parseXML, decodeEntities } from '../shared/diff/xml-parser.js'
import { compare } from '../shared/diff/diff.js'
import { nextId } from './db.js'

/* ---------- 工具 ---------- */

export function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return h
}

/** 種子化偽隨機（mulberry32） */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function camel(tag) {
  return tag.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function iso(d = new Date()) {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

/* ---------- AI 生成：主機 XML 請求 → 微服務系統 HTTP/JSON ---------- */

/**
 * @param {string} hostXml 主機請求 XML
 * @param {object} ctx { urlTemplate, defaultHeaders, envBaseUrl }
 * @returns {object} newInput { url, method, headers, body }
 */
export function aiGenerate(hostXml, { urlTemplate = [], defaultHeaders = [], envBaseUrl = '' } = {}) {
  let root
  try {
    root = parseXML(hostXml)
  } catch (e) {
    throw new Error(`主機請求 XML 解析失敗：${e.message}`)
  }

  const txnCode = findTxnCode(root)
  const modulePath = camel(root.tag)

  // URL：環境 baseUrl（存在時取代模板首段，即主機段）+ 其餘模板段 → 附加模組路徑/交易碼
  const segs = urlTemplate.filter((s) => s && s.value).map((s) => s.value.replace(/\/+$/, ''))
  const base = (envBaseUrl || segs[0] || '').replace(/\/+$/, '')
  const rest = (envBaseUrl ? segs.slice(1) : segs.slice(0)).join('/')
  const url = `${base}/${rest}/${modulePath}/${txnCode}`.replace(/([^:])\/+/g, '$1/')

  const body = elToJson(root)
  return {
    url,
    method: 'POST',
    headers: (defaultHeaders || []).filter((h) => h && h.enabled !== false).map((h) => ({ name: h.name, value: h.value })),
    body: JSON.stringify(body, null, 2),
  }
}

function findTxnCode(root) {
  let found = null
  const walk = (el) => {
    if (found) return
    if (el.tag === 'TxnCode' || el.tag === 'TxnCode' || el.tag.toLowerCase() === 'txncode') {
      found = el.children.map((c) => c.text).join('').trim()
      return
    }
    for (const c of el.children) if ('tag' in c) walk(c)
  }
  walk(root)
  return found || camel(root.tag)
}

function elToJson(el) {
  const out = {}
  const textParts = el.children.filter((c) => 'text' in c).map((c) => c.text)
  const elChildren = el.children.filter((c) => 'tag' in c)
  if (elChildren.length === 0) return textParts.join('').trim()
  const grouped = new Map()
  for (const c of elChildren) {
    if (!grouped.has(c.tag)) grouped.set(c.tag, [])
    grouped.get(c.tag).push(elToJson(c))
  }
  for (const [tag, items] of grouped) {
    out[camel(tag)] = items.length === 1 ? items[0] : items
  }
  if (textParts.join('').trim()) out['#text'] = textParts.join('').trim()
  return out
}

/* ---------- 執行模擬：依 profile 產出兩側回應 + diff ---------- */

/**
 * 每個案例的回應「行為設定檔」（seed 指定），決定兩系統輸出的差異場景。
 * 兩側共用同一份基礎資料（merged），Host 渲染為 XML（Header/Body 信封）、
 * 微服務系統渲染為 JSON（相同信封結構），再依 profile 施加路徑覆蓋/刪除——
 * 使 diff 只反映意圖中的差異，不被結構噪音干擾。值全部用字串。
 */

/** profile → 微服務系統側的覆蓋（路徑式；'Account.X' 指 Body.Account.X，'TxnTime' 指 Header.TxnTime） */
const NEW_PROFILE = {
  pass: { overrides: {}, drop: [] },
  'diff-time': { overrides: { TxnTime: '2026-08-26T01:30:00.000Z' }, drop: [] }, // 同一時刻，+08:00 → Z
  'diff-amount': { overrides: { 'Account.Balance': '9999.00' }, drop: [] },
  'diff-renamed': { overrides: { 'Account.CustomerName': '陳大文' }, drop: ['Account.AcctName'] },
  'diff-array-len': { overrides: { 'Account.Transactions': 'SLICE_2' }, drop: [] }, // 主機 3 筆 vs 新 2 筆
  'diff-added-field': { overrides: { 'Account.RiskLevel': 'LOW' }, drop: [] },
  'diff-missing-field': { overrides: {}, drop: ['Account.Status'] },
  'diff-precision': { overrides: { 'Account.Balance': '12345.669999' }, drop: [] },
  'diff-longnum': { overrides: { 'Account.AcctNo': '123456789012345679' }, drop: [] },
}

export function buildHostResponse(c) {
  return renderHost(baseResponse(c))
}

export function buildNewResponse(c) {
  const merged = baseResponse(c)
  const spec = NEW_PROFILE[c.profile] || { overrides: {}, drop: [] }
  for (const [p, v] of Object.entries(spec.overrides)) {
    if (v === 'SLICE_2') {
      merged.Account.Transactions = merged.Account.Transactions.slice(0, 2)
    } else {
      setPath(merged, p, v)
    }
  }
  for (const p of spec.drop) delPath(merged, p)
  return renderNew(merged)
}

/** 基礎回應資料（依交易碼雜湊微調，避免所有案例完全一樣） */
function baseResponse(c) {
  const r = rng(hash(c.txnCode))
  const balance = (r() * 90000 + 1000).toFixed(2)
  const name = ['陳大文', '李小明', '黃雅婷', '何俊傑', '吳美玲'][hash(c.txnCode) % 5]
  const txns = [
    { Seq: '1', Amount: (r() * 2000 + 100).toFixed(2), Date: '20260824' },
    { Seq: '2', Amount: (r() * 3000 + 100).toFixed(2), Date: '20260825' },
    { Seq: '3', Amount: (r() * 4000 + 100).toFixed(2), Date: '20260826' },
  ]
  return {
    TxnCode: c.txnCode,
    TxnTime: '2026-08-26T09:30:00.000+08:00',
    RespCode: '0000',
    RespMsg: '成功',
    Account: {
      AcctNo: '123456789012345678',
      AcctName: name,
      Balance: balance,
      Currency: 'HKD',
      Status: 'A',
      AvailableBalance: balance,
      Transactions: txns,
    },
  }
}

function setPath(obj, path, val) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
  cur[parts[parts.length - 1]] = val
}

function delPath(obj, path) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
  delete cur[parts[parts.length - 1]]
}

function renderHost(m) {
  const { TxnCode, TxnTime, RespCode, RespMsg, Account } = m
  const txns = (Account.Transactions || [])
    .map(
      (t) => `      <Transaction><Seq>${t.Seq}</Seq><Amount>${t.Amount}</Amount><Date>${t.Date}</Date></Transaction>`
    )
    .join('\n')
  const acctName = Account.AcctName ? `\n      <AcctName>${Account.AcctName}</AcctName>` : ''
  const status = Account.Status ? `\n      <Status>${Account.Status}</Status>` : ''
  const txnsBlock = Account.Transactions ? `\n      <Transactions>\n${txns}\n      </Transactions>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<AccountInquiryResponse xmlns="urn:boc:host:acct">
  <Header>
    <TxnCode>${TxnCode}</TxnCode>
    <TxnTime>${TxnTime}</TxnTime>
    <RespCode>${RespCode}</RespCode>
    <RespMsg>${RespMsg}</RespMsg>
  </Header>
  <Body>
    <Account>
      <AcctNo>${Account.AcctNo}</AcctNo>${acctName}
      <Balance>${Account.Balance}</Balance>
      <Currency>${Account.Currency}</Currency>${status}
      <AvailableBalance>${Account.AvailableBalance}</AvailableBalance>${txnsBlock}
    </Account>
  </Body>
</AccountInquiryResponse>`
}

function renderNew(m) {
  const { TxnCode, TxnTime, RespCode, RespMsg, Account } = m
  return JSON.stringify(
    {
      Header: { TxnCode, TxnTime, RespCode, RespMsg },
      Body: { Account },
    },
    null,
    2
  )
}

/* ---------- 案例執行 ---------- */

/**
 * 執行單條案例 → 完整 Run
 * - compare 模式（mode!=='http'）：主機 vs 微服務系統輸出，走 shared/diff 比對（與前端同一演算法）
 * - http 模式（mode==='http'）：單獨 HTTP 請求，verdict 按 HTTP 狀態碼（2xx=PASS），無 diff
 * 兩種模式都輸出 steps（執行過程步驟，供詳情頁時間線展示）
 */
export function runCase(c, { config = null, type = 'SINGLE', batchId = null, runBy = '測試工程師 陳', runIndex = 0, at = null, version = null } = {}) {
  const startedAt = at || new Date().toISOString()
  const hRng = rng(hash(c.id + 'h' + runIndex))
  const nRng = rng(hash(c.id + 'n' + runIndex))
  const httpMode = c.mode === 'http'

  if (httpMode) {
    const httpStatus = c.profile === 'http-fail' ? 500 : 200
    const rawBody = c.profile === 'http-fail' ? '{"code":5000,"message":"內部服務器錯誤"}' : buildNewResponse(c)
    const latency = 60 + Math.floor(nRng() * 150)
    const verdict = httpStatus >= 200 && httpStatus < 300 ? 'PASS' : 'FAIL'
    const steps = [
      { name: '準備請求', status: 'ok', ms: 4 + Math.floor(nRng() * 8), detail: `${c.newInput?.method || 'POST'} ${c.newInput?.url || ''}` },
      { name: '發送請求', status: 'ok', ms: latency, detail: `HTTP ${httpStatus}` },
      { name: '解析響應', status: 'ok', ms: 6 + Math.floor(nRng() * 10), detail: `${String(rawBody).length} 字元` },
      { name: '判定', status: verdict === 'PASS' ? 'ok' : 'fail', ms: 1, detail: verdict === 'PASS' ? 'HTTP 2xx，執行成功' : `HTTP 非 2xx（${httpStatus}），執行失敗` },
    ]
    return {
      id: nextId('R'),
      caseId: c.id,
      batchId,
      type,
      version: version || null,
      caseType: c.type || 'Regular',      // 執行結果體現案例類型
      testType: c.testType || 'SIT',      // 執行結果體現測試類型（SIT/UAT）
      inputSnapshot: {
        hostXml: '',
        newInput: c.newInput || null,
      },
      hostResult: null,
      newResult: { httpStatus, latencyMs: latency, rawBody },
      diff: null,
      verdict,
      steps,
      stateNote: c.precondition || null,
      runBy,
      startedAt,
      finishedAt: new Date(Date.parse(startedAt) + 80 + latency + Math.floor(nRng() * 300)).toISOString(),
    }
  }

  const hostBody = buildHostResponse(c)
  const newBody = buildNewResponse(c)
  const hostLatency = 80 + Math.floor(hRng() * 200)
  const newLatency = 60 + Math.floor(nRng() * 150)

  const diff = compare(hostBody, newBody, {
    stateType: c.stateType,
    rules: config?.diffRules || {},
    extraMeta: { stateNote: c.precondition || '', caseName: c.name, txnCode: c.txnCode },
  })

  const steps = [
    { name: '準備請求', status: 'ok', ms: 4 + Math.floor(hRng() * 8), detail: `主機報文 ${String(c.hostInput?.rawXml || '').length} 字元` },
    { name: '發送主機請求', status: 'ok', ms: hostLatency, detail: `HTTP 200` },
    { name: '解析主機響應', status: 'ok', ms: 6 + Math.floor(hRng() * 10), detail: `${String(hostBody).length} 字元` },
    { name: '發送微服務系統請求', status: 'ok', ms: newLatency, detail: `HTTP 200 · ${c.newInput?.url || ''}` },
    { name: '解析微服務系統響應', status: 'ok', ms: 6 + Math.floor(nRng() * 10), detail: `${String(newBody).length} 字元` },
    { name: '字段比對', status: 'ok', ms: 3 + Math.floor(nRng() * 12), detail: `發現 ${diff.items.length} 處差異` },
    { name: '判定', status: diff.verdict === 'PASS' ? 'ok' : 'warn', ms: 1, detail: diff.verdict === 'PASS' ? '兩側輸出一致，通過' : diff.verdict === 'DIFF' ? '存在差異，需人工評估' : '存在高可疑差異，判定失敗' },
  ]

  return {
    id: nextId('R'),
    caseId: c.id,
    batchId,
    type,
    version: version || null,
    caseType: c.type || 'Regular',      // 執行結果體現案例類型
    testType: c.testType || 'SIT',      // 執行結果體現測試類型（SIT/UAT）
    inputSnapshot: {
      hostXml: c.hostInput?.rawXml || '',
      newInput: c.newInput || null,
    },
    hostResult: { httpStatus: 200, latencyMs: hostLatency, rawBody: hostBody },
    newResult: { httpStatus: 200, latencyMs: newLatency, rawBody: newBody },
    diff,
    steps,
    verdict: diff.verdict,
    stateNote: c.precondition || null,
    runBy,
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 200 + Math.floor(hRng() * 800)).toISOString(),
  }
}

/* ---------- 壓測曲線 ---------- */

export function buildStressRun(plan, at = new Date().toISOString()) {
  const r = rng(hash(plan.id + (plan.runCount || 0)))
  const peakTps = Math.max(10, Math.round(plan.concurrency * 8))
  const ramp = Math.min(plan.rampUpSec || 10, plan.durationSec)
  const series = []
  let total = 0
  for (let t = 1; t <= plan.durationSec; t++) {
    const load = Math.min(1, t / ramp) * (0.85 + 0.15 * Math.sin(t / 3))
    const tps = Math.max(0, Math.round(peakTps * load * (0.9 + r() * 0.2)))
    const latencyP50 = Math.round(80 + load * plan.concurrency * 3 + r() * 40)
    const errorRate = Math.min(8, (load > 0.9 ? 2.5 + r() * 2 : 0.3 + r() * 0.8)).toFixed(2)
    total += tps
    series.push({ tSec: t, tps, errorRate: Number(errorRate), latencyP50 })
  }
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))]
  }
  const latArr = series.map((s) => s.latencyP50)
  return {
    id: nextId('SR'),
    planId: plan.id,
    status: 'done',
    startedAt: at,
    finishedAt: new Date(Date.parse(at) + plan.durationSec * 1000 + 500).toISOString(),
    summary: {
      tps: Math.round(total / Math.max(1, series.length)),
      avgLatencyMs: Math.round(latArr.reduce((a, b) => a + b, 0) / latArr.length),
      p50: pct(latArr, 50),
      p90: pct(latArr, 90),
      p95: pct(latArr, 95),
      p99: pct(latArr, 99),
      errorRate: Number((series.reduce((a, s) => a + s.errorRate, 0) / series.length).toFixed(2)),
      totalRequests: total,
    },
    series,
  }
}

export { decodeEntities }
