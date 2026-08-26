/**
 * Mock API 路由表（對齊 docs/API-LIST.md 契約）
 * 統一響應：{ code:0, message:'ok', data }；錯誤：{ code:4xxx, message }
 */

import { find, findAll, insert, paginate, remove, update } from './db.js'
import { aiGenerate, buildStressRun, hash, runCase, iso } from './generators.js'
import { analyzeFailure } from './ai-analyzer.js'

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
    const run = runCase(c, { config: db.config, type: 'BATCH', batchId: batch.id, runIndex: 1, version: batch.version })
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

  /* ---------- 業務模組（可獨立維護） ---------- */
  get(/^\/api\/modules$/, () => {
    const withCount = [...db.modules].map((m) => ({
      ...m,
      caseCount: db.cases.filter((c) => c.module === m.name).length,
    }))
    return ok(withCount)
  })
  post(/^\/api\/modules$/, (q, m, body) => {
    const { name, code, description } = body || {}
    if (!name || !code) return err(4000, '模組名稱與代碼必填')
    if (db.modules.some((x) => x.code === code)) return err(4000, `模組代碼 ${code} 已存在`)
    const rec = insert(db, 'modules', { name, code, description: description || '', createdAt: now() })
    return ok(rec)
  })
  put(/^\/api\/modules\/([A-Za-z0-9]+)$/, (q, m, body) => {
    const x = find(db, 'modules', m[1])
    if (!x) return err(4040, '模組不存在')
    const patch = {}
    if (body?.name) patch.name = body.name
    if (body?.code) patch.code = body.code
    if (body?.description !== undefined) patch.description = body.description
    return ok(update(db, 'modules', x.id, patch))
  })
  del(/^\/api\/modules\/([A-Za-z0-9]+)$/, (q, m) => {
    const x = find(db, 'modules', m[1])
    if (!x) return err(4040, '模組不存在')
    if (db.cases.some((c) => c.module === x.name)) return err(4000, '該模組下仍有案例，無法刪除（可改為停用或先調整案例）')
    remove(db, 'modules', m[1])
    return ok({ id: m[1], deleted: true })
  })

  /* ---------- 案例類型（可獨立維護；案例.type 引用） ---------- */
  get(/^\/api\/case-types$/, () => {
    const withCount = [...db.caseTypes].map((t) => ({
      ...t,
      caseCount: db.cases.filter((c) => c.type === t.name).length,
    }))
    return ok(withCount)
  })
  post(/^\/api\/case-types$/, (q, m, body) => {
    const { name, description } = body || {}
    if (!name || !String(name).trim()) return err(4000, '案例類型名稱必填')
    if (db.caseTypes.some((x) => x.name === name)) return err(4000, `案例類型「${name}」已存在`)
    const rec = insert(db, 'caseTypes', { name, description: description || '', createdAt: now() })
    return ok(rec)
  })
  put(/^\/api\/case-types\/([A-Za-z0-9]+)$/, (q, m, body) => {
    const x = find(db, 'caseTypes', m[1])
    if (!x) return err(4040, '案例類型不存在')
    const patch = {}
    if (body?.name) {
      if (db.caseTypes.some((t) => t.name === body.name && t.id !== x.id)) return err(4000, `案例類型「${body.name}」已存在`)
      patch.name = body.name
    }
    if (body?.description !== undefined) patch.description = body.description
    return ok(update(db, 'caseTypes', x.id, patch))
  })
  del(/^\/api\/case-types\/([A-Za-z0-9]+)$/, (q, m) => {
    const x = find(db, 'caseTypes', m[1])
    if (!x) return err(4040, '案例類型不存在')
    if (db.cases.some((c) => c.type === x.name)) return err(4000, '該類型下仍有案例，無法刪除（可先調整案例類型）')
    remove(db, 'caseTypes', m[1])
    return ok({ id: m[1], deleted: true })
  })

  /* ---------- 版本號（案例中心維護；執行時選擇） ---------- */
  get(/^\/api\/versions$/, () => ok([...db.versions].sort((a, b) => b.code.localeCompare(a.code)).map((v) => ({
    ...v,
    // 執行記錄統計（回溯歷史執行用）
    runCount: db.runs.filter((r) => r.version === v.code).length,
    executedCaseCount: new Set(db.runs.filter((r) => r.version === v.code).map((r) => r.caseId)).size,
    // 顯式關聯統計（批量「加入版本」）：關聯 ∪ 執行過 的去重案例數
    linkedCaseCount: db.cases.filter((c) => (c.versions || []).includes(v.code)).length,
    caseCount: new Set([
      ...db.runs.filter((r) => r.version === v.code).map((r) => r.caseId),
      ...db.cases.filter((c) => (c.versions || []).includes(v.code)).map((c) => c.id),
    ]).size,
  }))))
  post(/^\/api\/versions$/, (q, m, body) => {
    const { month, mode } = body || {}
    if (!/^\d{4}-\d{2}$/.test(month || '')) return err(4000, '月份格式須為 YYYY-MM')
    if (mode !== 'A' && mode !== 'Z') return err(4000, '模式須為 A（集中版本）或 Z（非集中版本）')
    const code = month.replace('-', '') + mode
    if (db.versions.some((v) => v.code === code)) return err(4000, `版本號 ${code} 已存在`)
    const rec = insert(db, 'versions', {
      code,
      month: month.replace('-', ''),
      mode,
      modeLabel: mode === 'A' ? '集中版本' : '非集中版本',
      createdAt: now(),
    })
    return ok(rec)
  })
  del(/^\/api\/versions\/([A-Za-z0-9]+)$/, (q, m) => {
    const v = find(db, 'versions', m[1])
    if (!v) return err(4040, '版本不存在')
    remove(db, 'versions', m[1])
    return ok({ id: m[1], deleted: true })
  })

  /* ---------- Dashboard ---------- */
  get(/^\/api\/dashboard\/summary$/, () => {
    const runs = db.runs
    const verdictCount = (v) => runs.filter((r) => r.verdict === v).length
    const pass = verdictCount('PASS')
    // 生命周期節點：總案例 → 待審核 → 已審核（通過/駁回）→ 已執行（覆蓋場景）
    const reviewed = db.cases.filter((c) => c.status !== 'PENDING' && c.status !== 'DRAFT')
    const executedCases = db.cases.filter((c) => runs.some((r) => r.caseId === c.id))
    return ok({
      totalCases: db.cases.length,
      totalRuns: runs.length,
      passRate: runs.length ? Math.round((pass / runs.length) * 100) : 0,
      pendingReviews: db.cases.filter((c) => c.status === 'PENDING').length,
      reviewedCount: reviewed.length,
      approvedCount: reviewed.filter((c) => c.status === 'APPROVED').length,
      rejectedCount: reviewed.filter((c) => c.status === 'REJECTED').length,
      executedCount: executedCases.length,
      executedScenarios: new Set(executedCases.map((c) => c.profile)).size,
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
          summary: r.diff ? r.diff.summary : null,
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
    if (type === 'module-cards') {
      // 按業務模組聚合：案例數 / 運行數 / 通過率 / 最近判定
      const out = []
      const moduleOf = (m) => m || '未分類'
      const mods = [...new Set(db.cases.map((c) => moduleOf(c.module)))]
      for (const m of mods.sort()) {
        const caseRecs = db.cases.filter((c) => moduleOf(c.module) === m)
        const runRecs = db.runs.filter((r) => caseRecs.some((c) => c.id === r.caseId))
        const pass = runRecs.filter((r) => r.verdict === 'PASS').length
        const last = runRecs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null
        out.push({
          module: m,
          caseCount: caseRecs.length,
          runCount: runRecs.length,
          passRate: runRecs.length ? Math.round((pass / runRecs.length) * 100) : null,
          lastVerdict: last ? last.verdict : null,
          lastRunAt: last ? last.startedAt : null,
        })
      }
      return ok(out)
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
    const version = q.get('version') || ''
    let list = db.cases
    if (txnCode) list = list.filter((c) => c.txnCode.includes(txnCode))
    if (keyword) list = list.filter((c) => c.name.includes(keyword) || c.txnCode.includes(keyword) || c.id.includes(keyword.toUpperCase()))
    if (status) list = list.filter((c) => c.status === status)
    if (module) list = list.filter((c) => c.module === module)
    // 版本篩選：該版本「關聯（批量加入版本）∪ 執行過」的案例（回溯歷史執行）
    if (version) {
      const executed = new Set(db.runs.filter((r) => r.version === version).map((r) => r.caseId))
      list = list.filter((c) => executed.has(c.id) || (c.versions || []).includes(version))
    }
    list = [...list].sort((a, b) => a.txnCode.localeCompare(b.txnCode))
    return ok(paginate(list, q.get('page'), q.get('pageSize')))
  })

  /* 批量關聯版本：選中的案例加入指定版本（幂等，重複關聯自動跳過） */
  post(/^\/api\/cases\/batch-link$/, (q, m, body) => {
    const caseIds = Array.isArray(body?.caseIds) ? body.caseIds : []
    const version = resolveVersion(db, body?.version)
    if (!version) return err(4000, `版本號 ${body?.version} 不存在，請先到案例中心維護`)
    if (!caseIds.length) return err(4000, '請先勾選案例')
    let linked = 0
    const skipped = []
    for (const id of caseIds) {
      const c = find(db, 'cases', id)
      if (!c) continue
      const arr = c.versions || []
      if (arr.includes(version)) { skipped.push(id); continue }
      c.versions = [...arr, version]
      linked++
    }
    return ok({ linked, skipped: skipped.length, version })
  })

  /* 取消關聯：案例從指定版本移除（不影響執行歷史） */
  del(/^\/api\/cases\/([A-Za-z0-9]+)\/versions\/([A-Za-z0-9]+)$/, (q, m) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    const arr = c.versions || []
    if (!arr.includes(m[2])) return err(4040, `案例未關聯版本 ${m[2]}`)
    c.versions = arr.filter((v) => v !== m[2])
    return ok({ id: c.id, version: m[2], linked: false })
  })

  get(/^\/api\/cases\/([A-Za-z0-9]+)$/, (q, m) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    const logs = db.auditLogs.filter((l) => l.caseId === c.id)
    return ok({ ...c, auditLogs: logs })
  })

  post(/^\/api\/cases$/, (q, m, body) => {
    const { txnCode, name, module, stateType, hostInput, newInput, precondition, mode, hostFormat, type, testType } = body || {}
    if (!txnCode || !name) return err(4000, '交易碼與案例名稱必填')
    // 交易碼可維護（允許重複），唯一標識為系統生成的案例編號（C 開頭 id）
    if (type && !db.caseTypes.some((t) => t.name === type)) return err(4000, `案例類型「${type}」不存在，請先到「案例中心 → 案例類型」維護`)
    if (testType && testType !== 'SIT' && testType !== 'UAT') return err(4000, '測試類型須為 SIT 或 UAT')
    const c = insert(db, 'cases', {
      txnCode,
      name,
      systemId: db.meta.currentSystem,
      module: module || '未分類',
      stateType: stateType === 'STATEFUL' ? 'STATEFUL' : 'STATELESS',
      type: type || 'Regular',
      testType: testType || 'SIT',
      status: 'PENDING',
      precondition: precondition || '',
      mode: mode === 'http' ? 'http' : 'compare',
      hostFormat: hostFormat === 'JSON' ? 'JSON' : 'XML',
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
    const { txnCode, name, module, stateType, hostInput, newInput, precondition, mode, hostFormat, type, testType } = body || {}
    const patch = {}
    if (txnCode) patch.txnCode = txnCode // 交易碼可維護（唯一標識為案例編號，不變）
    if (name) patch.name = name
    if (module) patch.module = module
    if (stateType) patch.stateType = stateType === 'STATEFUL' ? 'STATEFUL' : 'STATELESS'
    if (mode) patch.mode = mode === 'http' ? 'http' : 'compare'
    if (hostFormat) patch.hostFormat = hostFormat === 'JSON' ? 'JSON' : 'XML'
    if (type) {
      if (!db.caseTypes.some((t) => t.name === type)) return err(4000, `案例類型「${type}」不存在，請先到「案例中心 → 案例類型」維護`)
      patch.type = type
    }
    if (testType) patch.testType = testType
    if (hostInput) patch.hostInput = { rawXml: hostInput.rawXml }
    if (newInput) patch.newInput = { ...newInput, refinedByHuman: true }
    if (precondition !== undefined) patch.precondition = precondition
    const contentChanged = Boolean(patch.newInput || patch.hostInput || patch.mode || patch.hostFormat)
    if (contentChanged) {
      patch.aiMeta = { source: 'ai', generatedAt: c.aiMeta?.generatedAt, refinedByHuman: true }
      patch.updatedAt = now()
    }
    // 報文/模式/格式任一變更 → 已審核案例重新回到待審核（清掉舊審核意見）
    if (contentChanged && (c.status === 'APPROVED' || c.status === 'REJECTED')) {
      patch.status = 'PENDING'
      patch.review = null
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
    const env = (db.config.environments || []).find((e) => e.current) || null
    const newInput = aiGenerate(hostXml, {
      urlTemplate: db.config.urlTemplate,
      defaultHeaders: db.config.defaultHeaders,
      envBaseUrl: env ? env.baseUrl : '',
    })
    return ok({ newInput, envId: env?.id || null })
  })

  /* ---------- 執行（可選指定版本號，版本在案例中心維護） ---------- */
  post(/^\/api\/cases\/([A-Za-z0-9]+)\/run$/, (q, m, body) => {
    const c = find(db, 'cases', m[1])
    if (!c) return err(4040, '案例不存在')
    const version = resolveVersion(db, body?.version)
    if (body?.version && !version) return err(4000, `版本號 ${body.version} 不存在，請先到案例中心維護`)
    const run = runCase(c, { config: db.config, type: 'SINGLE', runIndex: (db.runs.filter((r) => r.caseId === c.id).length || 0) + 1, version })
    insert(db, 'runs', run)
    c.lastRun = run
    return ok(run)
  })

  get(/^\/api\/cases\/([A-Za-z0-9]+)\/runs$/, (q, m) => {
    const list = db.runs
      .filter((r) => r.caseId === m[1])
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((r) => {
        const c = db.cases.find((x) => x.id === r.caseId)
        return {
          id: r.id,
          type: r.type,
          version: r.version || null,
          verdict: r.verdict,
          caseType: r.caseType || c?.type || 'Regular',
          testType: r.testType || c?.testType || 'SIT',
          summary: r.diff ? r.diff.summary : null,
          runBy: r.runBy,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
        }
      })
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
    const version = resolveVersion(db, body?.version)
    if (body?.version && !version) return err(4000, `版本號 ${body.version} 不存在，請先到案例中心維護`)
    const batch = insert(db, 'batchRuns', {
      name: body?.name || `批量回歸 ${now().slice(5, 16)}`,
      caseIds,
      version: version || null,
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
      status: 'pending', // 新建計劃需審批通過後才可執行
      review: null,
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
    if (p.status !== 'approved' && p.status !== 'done') {
      return err(4030, p.status === 'pending' ? '計劃尚未審批通過，需先由審批人批准後才可執行' : '計劃已被駁回，無法執行')
    }
    startStress(db, p)
    return ok({ id: p.id, status: 'running' })
  })

  /* 壓測計劃審批（演示雙角色：審批人操作） */
  post(/^\/api\/stress\/plans\/([A-Za-z0-9]+)\/review$/, (q, m, body) => {
    const p = find(db, 'stressPlans', m[1])
    if (!p) return err(4040, '計劃不存在')
    const action = body?.action
    if (action !== 'approve' && action !== 'reject') return err(4000, 'action 必須為 approve 或 reject')
    if (p.status === 'running') return err(4000, '運行中的計劃不能審批')
    update(db, 'stressPlans', p.id, {
      status: action === 'approve' ? 'approved' : 'rejected',
      review: { reviewer: db.meta.currentUser.name, comment: body?.comment || '', at: now() },
    })
    return ok(find(db, 'stressPlans', p.id))
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
    if (body?.environments) {
      // 環境整值替換：保證恰有一個 current
      const envs = body.environments.filter((e) => e && e.id)
      const current = envs.some((e) => e.current) ? envs.map((e) => ({ ...e, current: e.current === true })) : [{ ...envs[0], current: true }, ...envs.slice(1).map((e) => ({ ...e, current: false }))]
      patch.environments = current.map((e) => ({ id: e.id, name: e.name || e.id, baseUrl: e.baseUrl || '', current: e.current === true }))
    }
    if (body?.ai) {
      const prev = db.config.ai || {}
      patch.ai = {
        enabled: body.ai.enabled !== undefined ? body.ai.enabled : prev.enabled,
        mode: body.ai.mode || prev.mode,
        apiBase: (body.ai.apiBase ?? prev.apiBase ?? '').trim(),
        model: (body.ai.model ?? prev.model ?? '').trim(),
        // 脱敏值（含 •）不落庫，保留原密鑰
        apiKey: String(body.ai.apiKey ?? '').includes('•') ? prev.apiKey : String(body.ai.apiKey ?? ''),
      }
    }
    Object.assign(db.config, patch)
    return ok(db.config)
  })

  /* ---------- AI 初步分析（預留外部 AI API 接入，通過 config.ai 配置啟用） ---------- */
  post(/^\/api\/ai\/analyze$/, async (q, m, body) => {
    const cfg = db.config.ai || {}
    if (!cfg.enabled) return err(4000, 'AI 分析未啟用（可在系統配置中開啟）')
    const { caseId, runId } = body || {}
    const c = caseId ? find(db, 'cases', caseId) : null
    const run = runId ? find(db, 'runs', runId) : (c ? db.runs.find((r) => r.caseId === c.id) : null)
    if (!run) return err(4040, '找不到對應的運行記錄')
    if (cfg.mode === 'remote' && cfg.apiBase) {
      try {
        const remote = await remoteAnalyze(run, c, cfg)
        return ok(remote)
      } catch (e) {
        // 外部 API 失敗：回退本地規則引擎，並在響應中標注
        const local = analyzeFailure(run, c)
        return ok({ ...local, disclaimer: `${local.disclaimer}（外部 AI 調用失敗，已回退本地規則分析：${e.message}）` })
      }
    }
    return ok(analyzeFailure(run, c))
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

/** 解析版本號：code 或 id 均可；不存在返回 null（調用方決定是否報錯） */
function resolveVersion(db, v) {
  if (!v) return null
  if (typeof v === 'object') return v.code || null
  return db.versions.find((x) => x.code === String(v) || x.id === String(v))?.code || null
}

/** 外部 AI API 轉發（預留）：POST apiBase，body { prompt, model }，Authorization: Bearer apiKey
 * 響應兼容 { choices:[{message:{content}}] } / { content } / { result }；失敗拋錯由調用方回退本地規則 */
async function remoteAnalyze(run, c, cfg) {
  const items = (run.diff?.items || []).slice(0, 20)
    .map((i) => `${i.kind} ${i.path.join('.')}：主機=${i.hostValue ?? ''} vs 微服務=${i.newValue ?? ''}`).join('\n')
  const prompt = [
    `你是銀行接口測試分析助手。案例：${c?.name || ''}（${c?.txnCode || ''}），判定：${run.verdict}。`,
    run.diff
      ? `兩側報文字段級差異：\n${items || '（無）'}`
      : `HTTP 狀態：${run.newResult?.httpStatus ?? run.httpStatus}，步驟：${(run.steps || []).map((s) => `${s.name}:${s.status}`).join(',')}`,
    '請以 JSON 返回 { summary, reasons: [{level:"error|warn|info", text}], confidence }，簡潔列舉最可能的原因。',
  ].join('\n')
  const res = await fetch(cfg.apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ prompt, model: cfg.model || 'default', stream: false }),
  })
  if (!res.ok) throw new Error(`外部 AI API HTTP ${res.status}`)
  const j = await res.json().catch(() => { throw new Error('外部 AI API 響應非 JSON') })
  const content = j?.choices?.[0]?.message?.content ?? j?.content ?? j?.result ?? j?.output
  if (!content) throw new Error('外部 AI API 響應缺少 content')
  let parsed
  try { parsed = typeof content === 'string' ? JSON.parse(content) : content } catch { parsed = { summary: String(content) } }
  return {
    summary: parsed.summary || String(content).slice(0, 200),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((r) => (typeof r === 'string' ? { level: 'info', text: r } : r)).slice(0, 8) : [],
    confidence: parsed.confidence || '中',
    disclaimer: 'AI 初步分析僅供參考，請以字段級比對結果為準',
    model: cfg.model || 'external',
  }
}

export { hash }
