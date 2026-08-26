/**
 * 記憶體資料庫（Mock 專用）。與真實後端無關，僅為前端演示提供資料。
 * 集合：cases / runs / batchRuns / stressPlans / stressRuns / auditLogs
 * 單例：meta / systems / config
 */

let seq = 1

export function nextId(prefix) {
  return `${prefix}${String(seq++).padStart(4, '0')}`
}

export function createDB() {
  const db = {
    cases: [],
    runs: [],
    batchRuns: [],
    stressPlans: [],
    stressRuns: [],
    auditLogs: [],
    modules: [],
    systems: [],
    meta: null,
    config: null,
    seq: 1,
  }
  return db
}

export function insert(db, coll, rec) {
  const id = rec.id || nextId(coll === 'cases' ? 'C' : coll === 'runs' ? 'R' : coll === 'stressPlans' ? 'SP' : 'SR')
  rec.id = id
  db[coll].unshift(rec) // 新資料在前
  return rec
}

export function find(db, coll, id) {
  return db[coll].find((r) => r.id === id) || null
}

export function findAll(db, coll, pred) {
  return db[coll].filter(pred || (() => true))
}

export function update(db, coll, id, patch) {
  const rec = find(db, coll, id)
  if (!rec) return null
  Object.assign(rec, patch)
  return rec
}

export function remove(db, coll, id) {
  const idx = db[coll].findIndex((r) => r.id === id)
  if (idx < 0) return false
  db[coll].splice(idx, 1)
  return true
}

/** 分頁（list 已在呼叫方過濾排序） */
export function paginate(list, page = 1, pageSize = 10) {
  const p = Math.max(1, Number(page) || 1)
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 10))
  const start = (p - 1) * ps
  return { list: list.slice(start, start + ps), total: list.length, page: p, pageSize: ps }
}
