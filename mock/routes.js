/**
 * Mock API 路由表（對齊 docs/API-LIST.md 契約）
 * 統一響應：{ code:0, message:'ok', data }；錯誤：{ code:4xxx, message }
 */

import { find, findAll, insert, paginate, remove, update } from './db.js'
import { aiGenerate, buildStressRun, hash, runCase, iso } from './generators.js'

const ok = (data) => ({ code: 0, message: 'ok', data })
const err = (code, message) => ({ code, message })
const now = () => new Date().toISOString()

/** 批次模擬：每個案例間隔 ~700ms 執行一條（結果逐條記入 batch.caseResults 供前端輪詢） */
function startBatch(db, batch, caseRecs) {
  batch.status = 'running'
  batch.progress = { total: caseRecs.length, finished: 0, pass: 0, diff: 0, fail: 0 }
  batch.caseResults = caseRecs.map((c) => ({ caseId: c.id, txnCode: c.txnCode, status: 'pending' }))
  let i = 0
  const timer = setInterval(() => {
    if (i >= caseRecs.length) {
      clearInterval(timer)
      batch.status = 'done'
      batch.finishedAt = now()
      return
    }
    const c = caseRecs[i++]
    const run = runCase(c, { config: db.config, type: 'BATCH', batchId: batch.id, runIndex: 1 })
    insert(db, 'runs', run)
    c.lastRun = run
    batch.progress.finished = i
    batch.caseResults[i - 1].status = run.verdict
    if (run.verdict === 'PASS') batch.progress.pass++
    else if (run.verdict === 'FAIL') batch.progress.fail++
    else batch.progress.diff++
  }, 700)
}

/** 壓測模擬：~1.6s 後完成並生成曲線 */
function startStress(db, plan) {
  plan.status = 'running'
  plan.runCount = (plan.runCount || 0) + 1
  setTimeout(() => {
    const run = buildStressRun(plan, now())
    insert(db, 'stressRuns', run)
    plan.status = 'done'
    plan.lastRun = run
  }, 1600)
}

/** 路由表：method + regex（捕獲組即路徑參數） */
export function buildRoutes(db) {
  const routes = []

  const get = (re, h) => routes.push({ method: 'GET', re, h })
  const post = (re, h) => routes.push({ method: 'POST', re, h })
  const put = (re, h) => routes.push({ method: 'PUT', re, h })
  const del = (re, h) => routes.push({ method: 'DELETE', re, h })

  /* ---------- 元資料 / 權限 ---------- */
  get(/^\/api\/meta\/context$/, () => ok(db.meta))
  get(/^\/api\/systems$/, () => ok(db.systems))

  /* ---------- Dashboard ---------- */
  get(/^\/api\/dashboard\/summary$/, () => {
    const runs = db.runs
    const verdictCount = (v) => runs.filter((r) => r.verdict === v).length
    const pass = verdictCount('PASS')
    return ok({
      totalCases: db.cases.filter((c) => c.status !== 'DRAFT' || true).length,
      totalRuns: runs.length,
      passRate: runs.length ? Math.round((pass / runs.length) * 100) : 0,
      pendingReviews: db.cases.filter((c) => c.status === 'PENDING').length,
      coveredTxnCodes: new Set(db.cases.map((c) => c.txnCode)).size,
      runningBatch: db.batchRuns.find((b) => b.status === 'running') || null,
    })
  })

  get(/^\/api\/dashboard\/recent-runs$/, (q) => {
    const limit = Number(q.get('limit')) || 10
    const list = [...db.runs]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map((r) => {
        const c = db.cases.find((x) => x.id === r.caseId)
        return {
          id: r.id,
          caseId: r.caseId,
          txnCode: c?.txnCode || '',
          caseName: c?.name || '',
          verdict: r.verdict,
          stateType: c?.stateType,
          runBy: r.runBy,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          summary: r.diff.summary,
        }
      })
    return ok(list)
  })

  get(/^\/api\/dashboard\/pending-reviews$/, (q) => {
    const limit = Number(q.get('limit')) || 10
    const list = db.cases
      .filter((c) => c.status === 'PENDING')
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        txnCode: c.txnCode,
        name: c.name,
        module: c.module,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
      }))
    return ok(list)
  })

  get(/^\/api\/dashboard\/charts$/, (q) => {
    const type = q.get('type')
    if (type === 'status-distribution') {
      const labels = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']
      const series = labels.map((l) => db.cases.filter((c) => c.status === l).length)
      return ok({ labels, series })
    }
    if (type === 'module-distribution') {
      const map = new Map()
      for (const c of db.cases) map.set(c.module, (map.get(c.module) || 0) + 1)
      return ok({ labels: [...map.keys()], series: [...map.values()] })
    }
    if (type === 'execution-trend') {
      const labels = []
      const pass = []
      const diff = []
      const fail = []
      for (let d = 6; d >= 0; d--) {
        const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
        labels.push(day.slice(5))
        const dayRuns = db.runs.filter((r) => r.startedAt.slice(0, 10) === day)
        pass.push(dayRuns.filter((r) => r.verdict === 'PASS').length)
        diff.push(dayRuns.filter((r) => r.verdict === 'DIFF').length)
        fail.push(dayRuns.filter((r) => r.verdict === 'FAIL').length)
      }
      return ok({ labels, series: [{ name: '通過', data: pass }, { name: '差異', data: diff }, { name: '失敗', data: fail }] })
    }
    return err(4000, `未知圖表類型：${type}`)
  })

  /* ---------- 案例 CRUD ---------- */
  get(/^\/api\/cases$/, (q) => {
    const txnCode = q.get('txnCode') || ''
    const keyword = q.get('keyword') || ''
    const status = q.get('status') || ''
    const module = q.get('module') || ''
    let list = db.cases
    if (txnCode) list = list.filter((c) => c.txnCode.includes(txnCode))
    if (keyword) list = list.filter((c) => c.name.includes(keyword) || c.txnCode.includes(keyword))
    if (status) list = list.filter((c) => c.status === status)
    if (module) list = list.filter((c) => c.module === module)
    list = [...list].sort((a, b) => a.txnCode.localeCompare(b.txnCode))
    return ok(paginate(list, q.get('page'), q.get('pageSize')))
  })

  get(/^\/api\/cases\/([A-Za-z0-9]+)$/, (q, m) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    const logs = db.auditLogs.filter((l) => l.caseId === c.id)
    return ok({ ...c, auditLogs: logs })
  })

  post(/^\/api\/cases$/, (q, m, body) => {
    const { txnCode, name, module, stateType, hostInput, newInput, precondition } = body || {}
    if (!txnCode || !name) return err(4000, '交易碼與案例名稱必填')
    if (db.cases.some((c) => c.txnCode === txnCode)) return err(4000, `交易碼 ${txnCode} 已存在`)
    const c = insert(db, 'cases', {
      txnCode,
      name,
      systemId: db.meta.currentSystem,
      module: module || '未分類',
      stateType: stateType === 'STATEFUL' ? 'STATEFUL' : 'STATELESS',
      status: 'PENDING',
      precondition: precondition || '',
      profile: 'pass',
      hostInput: { rawXml: hostInput?.rawXml || '' },
      newInput: newInput || null,
      aiMeta: { source: newInput ? 'ai' : 'manual', generatedAt: now(), refinedByHuman: false },
      review: null,
      createdBy: db.meta.currentUser.name,
      createdAt: now(),
      updatedAt: now(),
      lastRun: null,
    })
    db.auditLogs.push({ id: `AL${c.id}`, caseId: c.id, action: 'create', from: '-', to: 'PENDING', operator: c.createdBy, at: now(), comment: '建立案例，待審核' })
    return ok(c)
  })

  put(/^\/api\/cases\/([A-Za-z0-9]+)$/, (q, m, body) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    const { name, module, stateType, hostInput, newInput, precondition } = body || {}
    const patch = {}
    if (name) patch.name = name
    if (module) patch.module = module
    if (stateType) patch.stateType = stateType === 'STATEFUL' ? 'STATEFUL' : 'STATELESS'
    if (hostInput) patch.hostInput = { rawXml: hostInput.rawXml }
    if (newInput) patch.newInput = { ...newInput, refinedByHuman: true }
    if (precondition !== undefined) patch.precondition = precondition
    if (patch.newInput || patch.hostInput) {
      patch.aiMeta = { source: 'ai', generatedAt: c.aiMeta?.generatedAt, refinedByHuman: true }
      patch.updatedAt = now()
    }
    if (c.status === 'PENDING' && body && body.hostInput) {
      // 修改後維持待審核；已審核案例修改後重新回到待審核
      if (c.status === 'APPROVED' || c.status === 'REJECTED') patch.status = 'PENDING'
    }
    const rec = update(db, 'cases', c.id, patch)
    return ok(rec)
  })

  del(/^\/api\/cases\/([A-Za-z0-9]+)$/, (q, m) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    if (c.status === 'APPROVED' && db.runs.some((r) => r.caseId === c.id)) {
      return err(4000, '該案例已有執行記錄，建議停用而非刪除；如需刪除請先聯絡管理員')
    }
    remove(db, 'cases', c.id)
    return ok({ id: c.id, deleted: true })
  })

  /* ---------- 審核 ---------- */
  post(/^\/api\/cases\/([A-Za-z0-9]+)\/review$/, (q, m, body) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    const action = body?.action
    if (action !== 'approve' && action !== 'reject') return err(4000, 'action 必須為 approve 或 reject')
    const to = action === 'approve' ? 'APPROVED' : 'REJECTED'
    update(db, 'cases', c.id, { status: to, review: { reviewer: db.meta.currentUser.name, comment: body?.comment || '', at: now() }, updatedAt: now() })
    db.auditLogs.unshift({
      id: `AL${c.id}-${db.auditLogs.length + 1}`,
      caseId: c.id,
      action,
      from: c.status,
      to,
      operator: db.meta.currentUser.name,
      at: now(),
      comment: body?.comment || '',
    })
    return ok(find(db, 'cases', c.id))
  })

  /* ---------- AI 生成 ---------- */
  post(/^\/api\/cases\/ai-generate$/, (q, m, body) => {
    const hostXml = body?.hostXml
    if (!hostXml) return err(4000, '缺少 hostXml')
    const newInput = aiGenerate(hostXml, { urlTemplate: db.config.urlTemplate, defaultHeaders: db.config.defaultHeaders })
    return ok({ newInput })
  })

  /* ---------- 執行 ---------- */
  post(/^\/api\/cases\/([A-Za-z0-9]+)\/run$/, (q, m) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    const run = runCase(c, { config: db.config, type: 'SINGLE', runIndex: (db.runs.filter((r) => r.caseId === c.id).length || 0) + 1 })
    insert(db, 'runs', run)
    c.lastRun = run
    return ok(run)
  })

  get(/^\/api\/cases\/([A-Za-z0-9]+)\/runs$/, (q, m) => {
    const list = db.runs
      .filter((r) => r.caseId === m[1])
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((r) => ({
        id: r.id,
        type: r.type,
        verdict: r.verdict,
        summary: r.diff.summary,
        runBy: r.runBy,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      }))
    return ok(paginate(list, q.get('page'), q.get('pageSize')))
  })

  get(/^\/api\/runs\/([A-Za-z0-9]+)$/, (q, m) => {
    const r = find(db, 'runs', m[1])
    if (!r) return err(4040, '運行記錄不存在')
    return ok(r)
  })

  /* ---------- 批量 ---------- */
  post(/^\/api\/batch-runs$/, (q, m, body) => {
    const caseIds = body?.caseIds || []
    if (!caseIds.length) return err(4000, '請選擇至少一個案例')
    const recs = caseIds.map((id) => find(db, 'cases', id)).filter(Boolean)
    if (!recs.length) return err(4000, '所選案例不存在')
    const batch = insert(db, 'batchRuns', {
      name: body?.name || `批量回歸 ${now().slice(5, 16)}`,
      caseIds,
      status: 'queued',
      progress: { total: recs.length, finished: 0, pass: 0, diff: 0, fail: 0 },
      runBy: db.meta.currentUser.name,
      startedAt: now(),
      finishedAt: null,
    })
    startBatch(db, batch, recs)
    return ok(batch)
  })

  get(/^\/api\/batch-runs\/([A-Za-z0-9]+)$/, (q, m) => {
    const b = find(db, 'batchRuns', m[1])
    if (!b) return err(4040, '批量運行不存在')
    return ok(b)
  })

  /* ---------- 壓測 ---------- */
  get(/^\/api\/stress\/plans$/, () => {
    const list = [...db.stressPlans].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return ok(list.map((p) => ({ ...p, lastRun: p.lastRun ? { id: p.lastRun.id, status: p.lastRun.status, summary: p.lastRun.summary, startedAt: p.lastRun.startedAt, finishedAt: p.lastRun.finishedAt } : null })))
  })

  post(/^\/api\/stress\/plans$/, (q, m, body) => {
    const { name, method, url, headers, body: reqBody, concurrency, durationSec, rampUpSec } = body || {}
    if (!name || !url) return err(4000, '計劃名稱與接口地址必填')
    const plan = insert(db, 'stressPlans', {
      name,
      method: method || 'POST',
      url,
      headers: headers || db.config.defaultHeaders,
      body: reqBody || '',
      concurrency: Math.max(1, Number(concurrency) || 10),
      durationSec: Math.max(5, Number(durationSec) || 60),
      rampUpSec: Math.min(Math.max(1, Number(rampUpSec) || 10), Math.max(5, Number(durationSec) || 60)),
      status: 'idle',
      runCount: 0,
      createdBy: db.meta.currentUser.name,
      createdAt: now(),
    })
    return ok(plan)
  })

  put(/^\/api\/stress\/plans\/([A-Za-z0-9]+)$/, (q, m, body) => {
    const p = find(db, 'stressPlans', m[1])
    if (!p) return err(4040, '計劃不存在')
    const patch = {}
    for (const k of ['name', 'method', 'url', 'headers', 'body', 'concurrency', 'durationSec', 'rampUpSec']) {
      if (body && body[k] !== undefined) patch[k] = body[k]
    }
    return ok(update(db, 'stressPlans', p.id, patch))
  })

  del(/^\/api\/stress\/plans\/([A-Za-z0-9]+)$/, (q, m) => {
    if (!remove(db, 'stressPlans', m[1])) return err(4040, '計劃不存在')
    return ok({ id: m[1], deleted: true })
  })

  get(/^\/api\/stress\/plans\/([A-Za-z0-9]+)$/, (q, m) => {
    const p = find(db, 'stressPlans', m[1])
    if (!p) return err(4040, '計劃不存在')
    return ok({ ...p, lastRun: p.lastRun ? { id: p.lastRun.id, status: p.lastRun.status, summary: p.lastRun.summary, startedAt: p.lastRun.startedAt, finishedAt: p.lastRun.finishedAt } : null })
  })

  post(/^\/api\/stress\/plans\/([A-Za-z0-9]+)\/run$/, (q, m) => {
    const p = find(db, 'stressPlans', m[1])
    if (!p) return err(4040, '計劃不存在')
    if (p.status === 'running') return err(4000, '該計劃正在運行中')
    startStress(db, p)
    return ok({ id: p.id, status: 'running' })
  })

  get(/^\/api\/stress\/runs\/([A-Za-z0-9]+)$/, (q, m) => {
    const r = find(db, 'stressRuns', m[1])
    if (!r) return err(4040, '壓測運行不存在')
    return ok(r)
  })

  /* ---------- 系統配置 ---------- */
  get(/^\/api\/config$/, () => ok(db.config))
  put(/^\/api\/config$/, (q, m, body) => {
    const patch = {}
    if (body?.urlTemplate) patch.urlTemplate = body.urlTemplate
    if (body?.defaultHeaders) patch.defaultHeaders = body.defaultHeaders
    if (body?.diffRules) patch.diffRules = { ...db.config.diffRules, ...body.diffRules }
    Object.assign(db.config, patch)
    return ok(db.config)
  })

  get(/^\/api\/audit-logs$/, (q) => {
    const caseId = q.get('caseId')
    let list = db.auditLogs
    if (caseId) list = list.filter((l) => l.caseId === caseId)
    return ok(list.sort((a, b) => (b.at || '').localeCompare(a.at || '')))
  })

  /* ---------- Word 導出（預留端點） ---------- */
  get(/^\/api\/cases\/export-word$/, () =>
    ok({ note: '此端點為預留：Word 導出目前由前端本地生成（HTML→.doc）' })
  )

  return routes
}

export { hash }
