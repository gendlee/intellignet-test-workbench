/**
 * 種子資料：10 個案例（覆蓋全部差異場景）、預置運行、壓測計劃、系統配置、審核記錄
 */

import { insert } from './db.js'
import { runCase, aiGenerate, buildStressRun, iso } from './generators.js'

const daysAgo = (n, h = 10) => new Date(Date.now() - n * 86400000).setHours(h, 30, 0, 0)
const isoAt = (t) => new Date(t).toISOString()

/** 主機請求樣板（按模組） */
const REQ = {
  account: (txnCode) => `<?xml version="1.0" encoding="UTF-8"?>
<AccountInquiryRequest>
  <Header>
    <TxnCode>${txnCode}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
    <TxnTime>2026-08-20T10:00:00.000+08:00</TxnTime>
  </Header>
  <Body>
    <AcctNo>123456789012345678</AcctNo>
    <Currency>HKD</Currency>
  </Body>
</AccountInquiryRequest>`,
  txn: (txnCode) => `<?xml version="1.0" encoding="UTF-8"?>
<TransactionListRequest>
  <Header>
    <TxnCode>${txnCode}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
  </Header>
  <Body>
    <AcctNo>123456789012345678</AcctNo>
    <StartDate>20260801</StartDate>
    <EndDate>20260826</EndDate>
  </Body>
</TransactionListRequest>`,
  pay: (txnCode) => `<?xml version="1.0" encoding="UTF-8"?>
<TransferRequest>
  <Header>
    <TxnCode>${txnCode}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
  </Header>
  <Body>
    <FromAcctNo>123456789012345678</FromAcctNo>
    <ToAcctNo>876543210987654321</ToAcctNo>
    <Amount>500.00</Amount>
    <Currency>HKD</Currency>
  </Body>
</TransferRequest>`,
  loan: (txnCode) => `<?xml version="1.0" encoding="UTF-8"?>
<LoanBalanceRequest>
  <Header>
    <TxnCode>${txnCode}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
  </Header>
  <Body>
    <LoanNo>LN2026000012</LoanNo>
  </Body>
</LoanBalanceRequest>`,
}

const URL_TEMPLATE = [
  { kind: 'fixed', value: 'https://newapi.boc.com.hk' },
  { kind: 'fixed', value: 'ebp' },
  { kind: 'var', value: 'api' },
  { kind: 'var', value: 'v1' },
]

/** 環境變量：AI 生成與執行時以「當前環境」的 baseUrl 拼接完整地址 */
const ENVIRONMENTS = [
  { id: 'SIT1', name: 'SIT1 系統集成測試', baseUrl: 'https://sit1.newapi.boc.com.hk', current: true },
  { id: 'SIT3', name: 'SIT3 系統集成測試', baseUrl: 'https://sit3.newapi.boc.com.hk', current: false },
  { id: 'USMK', name: 'USMK 市場測試', baseUrl: 'https://usmk.newapi.boc.com.hk', current: false },
  { id: 'USMF', name: 'USMF 市場試運行', baseUrl: 'https://usmf.newapi.boc.com.hk', current: false },
]

const DEFAULT_HEADERS = [
  { name: 'API-Key', value: 'boc-ebp-2026-demo', enabled: true, secret: true },
  { name: 'Content-Type', value: 'application/json', enabled: true, secret: false },
  { name: 'X-Client-Id', value: 'EBP-CL', enabled: true, secret: false },
]

const DIFF_RULES = {
  arrayMatchMode: 'index',
  arrayMatchKeys: {},
  ignoreFields: ['RespMsg'],
  dynamicRegex: ['.*(tStamp|nonce|traceId|requestId)$'],
  numeric: 'strict',
  longNumberGuard: 15,
  timeNormalize: true,
  attrMerge: true,
  namespaceInsensitive: true,
  emptyEqualsNull: false,
  wrapIgnoreKeys: [],
  collapseSingleArray: true,
}

/** 案例定義（profile 對應 generators.js 的差異場景） */
const CASE_SPECS = [
  { txnCode: 'ACCT1001', name: '帳戶查詢 — 基本成功', module: '帳戶查詢', req: REQ.account, profile: 'pass', stateType: 'STATELESS', status: 'APPROVED' },
  { txnCode: 'ACCT1002', name: '帳戶查詢 — 時間格式差異', module: '帳戶查詢', req: REQ.account, profile: 'diff-time', stateType: 'STATELESS', status: 'APPROVED' },
  { txnCode: 'ACCT1003', name: '帳戶查詢 — 餘額不一致', module: '帳戶查詢', req: REQ.account, profile: 'diff-amount', stateType: 'STATELESS', status: 'APPROVED' },
  { txnCode: 'ACCT1004', name: '交易明細查詢 — 字段重命名', module: '交易明細', req: REQ.txn, profile: 'diff-renamed', stateType: 'STATEFUL', status: 'APPROVED', precondition: '需先執行開戶 ACCT0001 並產生至少 1 筆交易' },
  { txnCode: 'ACCT1005', name: '交易明細查詢 — 數組長度差異', module: '交易明細', req: REQ.txn, profile: 'diff-array-len', stateType: 'STATELESS', status: 'APPROVED' },
  { txnCode: 'PAYM2001', name: '轉賬 — 微服務系統新增字段', module: '轉賬', req: REQ.pay, profile: 'diff-added-field', stateType: 'STATEFUL', status: 'APPROVED', precondition: '需先完成轉賬授權簽核' },
  { txnCode: 'PAYM2002', name: '轉賬 — 微服務系統缺少字段', module: '轉賬', req: REQ.pay, profile: 'diff-missing-field', stateType: 'STATEFUL', status: 'PENDING', precondition: '需先完成轉賬授權簽核' },
  { txnCode: 'LOAN3001', name: '貸款餘額查詢 — 精度差異', module: '貸款查詢', req: REQ.loan, profile: 'diff-precision', stateType: 'STATELESS', status: 'APPROVED' },
  { txnCode: 'LOAN3002', name: '貸款明細 — 長數字精度風險', module: '貸款查詢', req: REQ.loan, profile: 'diff-longnum', stateType: 'STATELESS', status: 'APPROVED' },
  { txnCode: 'MISC9001', name: '查詢費率 — 已駁回', module: '費率查詢', req: REQ.loan, profile: 'pass', stateType: 'STATELESS', status: 'REJECTED' },
]

export function seedDB(db) {
  db.systems = [
    { id: 'EBP-CL', name: 'EBP-CL 企業銀行平台', active: true, readOnly: false },
    { id: 'EBP-RTL', name: 'EBP-RTL 零售銀行平台', active: false, readOnly: true },
    { id: 'EBP-TRD', name: 'EBP-TRD 交易平台', active: false, readOnly: true },
  ]
  db.meta = {
    currentUser: { id: 'u001', name: '測試工程師 陳', role: 'tester' },
    currentSystem: 'EBP-CL',
    systems: db.systems,
    features: { aiGenerate: true, capture: false, stress: true, multiSystem: false },
  }
  db.config = {
    systemId: 'EBP-CL',
    readOnly: false,
    urlTemplate: URL_TEMPLATE,
    environments: ENVIRONMENTS,
    defaultHeaders: DEFAULT_HEADERS,
    diffRules: DIFF_RULES,
  }

  // 業務模組（可獨立維護）
  const MODULES = [
    { code: 'ACCT', name: '帳戶查詢', description: '帳戶餘額、基本資料與交易明細查詢' },
    { code: 'PAYM', name: '轉賬', description: '行內/跨行轉賬與授權' },
    { code: 'LOAN', name: '貸款查詢', description: '貸款餘額與明細查詢' },
    { code: 'TXNL', name: '交易明細', description: '交易明細清單查詢' },
    { code: 'MISC', name: '費率查詢', description: '銀行費率/匯率查詢' },
  ]
  db.modules = MODULES.map((m, i) => ({
    id: `M${String(i + 1).padStart(2, '0')}`,
    ...m,
    createdAt: isoAt(daysAgo(10, 9)),
  }))

  // 案例
  const cases = CASE_SPECS.map((s, i) => {
    const rawXml = s.req(s.txnCode)
    const ai = aiGenerate(rawXml, { urlTemplate: URL_TEMPLATE, defaultHeaders: DEFAULT_HEADERS })
    const c = {
      id: '',
      txnCode: s.txnCode,
      name: s.name,
      systemId: 'EBP-CL',
      module: s.module,
      stateType: s.stateType,
      status: s.status,
      precondition: s.precondition || '',
      mode: 'compare',
      hostFormat: 'XML',
      profile: s.profile,
      hostInput: { rawXml },
      newInput: { ...ai, refinedByHuman: false },
      aiMeta: { source: 'ai', generatedAt: isoAt(daysAgo(9, 9)), refinedByHuman: false },
      review: s.status === 'APPROVED' ? { reviewer: '審核專員 李', comment: '審核通過，案例有效', at: isoAt(daysAgo(8, 11)) } : s.status === 'REJECTED' ? { reviewer: '審核專員 李', comment: '報文缺少必填字段，請補充後重新提交', at: isoAt(daysAgo(2, 15)) } : null,
      createdBy: '測試工程師 陳',
      createdAt: isoAt(daysAgo(9, 9 + i)),
      updatedAt: isoAt(daysAgo(3, 9 + i)),
    }
    return c
  })
  for (const c of cases) insert(db, 'cases', c)

  // 審核記錄（APPROVED / REJECTED 案例）
  for (const c of cases) {
    if (c.review) {
      db.auditLogs.push({
        id: `AL${c.id}`,
        caseId: c.id,
        action: c.status === 'APPROVED' ? 'approve' : 'reject',
        from: 'PENDING',
        to: c.status,
        operator: c.review.reviewer,
        at: c.review.at,
        comment: c.review.comment,
      })
    }
  }

  // 預置運行（近 7 天，供 Dashboard 趨勢與最近運行）
  const runnable = cases.filter((c) => c.status === 'APPROVED' || c.status === 'REJECTED')
  const runSeeds = [
    { c: 'ACCT1001', days: [6, 5, 4, 3, 2, 1, 0] },
    { c: 'ACCT1002', days: [6, 4, 2] },
    { c: 'ACCT1003', days: [5, 3, 1] },
    { c: 'ACCT1004', days: [4, 2] },
    { c: 'ACCT1005', days: [3, 1] },
    { c: 'PAYM2001', days: [2] },
    { c: 'LOAN3001', days: [5, 0] },
    { c: 'LOAN3002', days: [4, 0] },
  ]
  for (const { c: txn, days } of runSeeds) {
    const caseRec = runnable.find((x) => x.txnCode === txn)
    if (!caseRec) continue
    days.forEach((d, i) => {
      const at = isoAt(daysAgo(d, 10 + (i % 5)))
      const run = runCase(caseRec, { config: db.config, runBy: '測試工程師 陳', runIndex: i + 1, at })
      insert(db, 'runs', run)
    })
  }
  // 最新一次運行回填案例 lastRun（列表內聯展示用）
  for (const c of runnable) {
    const last = db.runs.find((r) => r.caseId === c.id)
    if (last) c.lastRun = last
  }

  // 壓測計劃（審批流程：pending → approved/rejected → running → done）
  const plans = [
    { id: '', name: '帳戶查詢 — 日常峰值壓測', method: 'POST', url: 'https://newapi.boc.com.hk/ebp/api/v1/accountInquiry/ACCT1001', headers: DEFAULT_HEADERS, body: '{"acctNo":"123456789012345678","currency":"HKD"}', concurrency: 50, durationSec: 60, rampUpSec: 10, status: 'approved', review: { reviewer: '審核專員 李', comment: '計劃合理，批准執行', at: isoAt(daysAgo(2, 13, 40)) }, createdBy: '測試工程師 陳', createdAt: isoAt(daysAgo(2, 14)) },
    { id: '', name: '轉賬接口 — 高併發驗證', method: 'POST', url: 'https://newapi.boc.com.hk/ebp/api/v1/transfer/PAYM2001', headers: DEFAULT_HEADERS, body: '{"fromAcctNo":"...","amount":"500.00"}', concurrency: 120, durationSec: 120, rampUpSec: 20, status: 'pending', review: null, createdBy: '測試工程師 陳', createdAt: isoAt(daysAgo(1, 16)) },
    { id: '', name: '交易明細 — 穩定性測試', method: 'POST', url: 'https://newapi.boc.com.hk/ebp/api/v1/transactionList/ACCT1004', headers: DEFAULT_HEADERS, body: '{"acctNo":"123456789012345678","startDate":"20260801"}', concurrency: 30, durationSec: 300, rampUpSec: 30, status: 'approved', review: { reviewer: '審核專員 李', comment: '批准執行', at: isoAt(daysAgo(3, 10, 20)) }, createdBy: '測試工程師 陳', createdAt: isoAt(daysAgo(4, 11)) },
  ]
  for (const p of plans) {
    const rec = insert(db, 'stressPlans', p)
    if (p.id === plans[0].id) {
      const run = buildStressRun({ ...rec, runCount: 1 }, isoAt(daysAgo(2, 14, 30)))
      insert(db, 'stressRuns', run)
      rec.lastRun = run
      rec.status = 'done'
    }
  }
}
