# 中銀香港智能化API測試工作台 — API 清單

> 本文件為前端與後端的對接契約。內建 Mock 伺服器（`server.js`）逐項實現以下端點，前端經 `public/js/api.js` 單點發送（`window.APP_CONFIG?.apiBase` 可切換真實後端，見 README）。

## 通用約定

| 項目 | 約定 |
|---|---|
| 響應包裹 | `{ "code": 0, "message": "ok", "data": ... }`；`code !== 0` 為錯誤 |
| 分頁 | `data: { list, total, page, pageSize }` |
| 時間 | ISO 8601 UTC（`2026-08-26T03:30:00.000Z`） |
| 鑑權 | `Authorization` 頭預留，Mock 不校驗 |
| 傳輸 | `Content-Type: application/json`；請求體 JSON |
| 模擬延遲 | 查詢類 80–200ms；執行類 1.5–3s；AI 生成 1.2s；壓測按計劃時長 |

## 端點總覽

| Method | Path | 說明 | 頁面 |
|---|---|---|---|
| GET | `/api/meta/context` | 頂欄/權限/功能開關 | 全部 |
| GET | `/api/systems` | 系統列表 | 配置 |
| GET | `/api/dashboard/summary` | KPI 彙總 | 儀表板 |
| GET | `/api/dashboard/recent-runs?limit=` | 最近運行 | 儀表板 |
| GET | `/api/dashboard/pending-reviews?limit=` | 待審核案例 | 儀表板 |
| GET | `/api/dashboard/charts?type=` | 圖表數據（status-distribution / module-distribution / execution-trend） | 儀表板 |
| GET | `/api/cases?txnCode=&keyword=&status=&module=&page=&pageSize=` | 案例列表（內聯 lastRun，需求5） | 案例 |
| GET | `/api/cases/{id}` | 案例詳情（含 auditLogs） | 詳情 |
| POST | `/api/cases` | 新建案例 | 錄入 |
| PUT | `/api/cases/{id}` | 更新案例 | 錄入 |
| DELETE | `/api/cases/{id}` | 軟刪除（置為 DELETED） | 案例 |
| POST | `/api/cases/{id}/review` | 審核 `{action, comment}`，自動寫 AuditLog | 詳情 |
| POST | `/api/cases/ai-generate` | 主控 XML → 新系統 HTTP/JSON 案例（需求1） | 錄入 |
| POST | `/api/cases/{id}/run` | 單條執行，返回完整 Run（含 diff，需求4） | 詳情 |
| GET | `/api/cases/{id}/runs?page=` | 運行歷史分頁 | 詳情 |
| GET | `/api/runs/{id}` | 運行詳情（含 diff.items） | 詳情 |
| POST | `/api/batch-runs` | `{caseIds[]}` 啟動批量回歸（需求6） | 案例 |
| GET | `/api/batch-runs/{id}` | 批次進度輪詢 | 案例 |
| GET/POST/PUT/DELETE | `/api/stress/plans` | 壓測計劃 CRUD | 壓測 |
| POST | `/api/stress/plans/{id}/run` | 啟動壓測 | 壓測 |
| GET | `/api/stress/plans/{id}` | 計劃狀態 + lastRun | 壓測 |
| GET | `/api/stress/runs/{id}` | 壓測結果（summary + series） | 壓測 |
| GET/PUT | `/api/config` | 系統配置（URL 模板/默認請求頭/diff 規則） | 配置 |
| GET | `/api/audit-logs?caseId=` | 審核/變更流轉記錄（預留審計） | 詳情 |
| GET | `/api/cases/export-word` | 導出預留端點（前端預設本地導出，需求12） | — |

---

## 詳細契約

### GET /api/meta/context

```json
{
  "code": 0, "message": "ok",
  "data": {
    "currentUser": { "id": "u001", "name": "測試工程師 陳", "role": "tester" },
    "currentSystem": "EBP-CL",
    "systems": [
      { "id": "EBP-CL",  "name": "EBP-CL 企業銀行平台", "active": true,  "readOnly": false },
      { "id": "EBP-RTL", "name": "EBP-RTL 零售銀行平台", "active": false, "readOnly": true },
      { "id": "EBP-TRD", "name": "EBP-TRD 交易平台",   "active": false, "readOnly": true }
    ],
    "features": { "aiGenerate": true, "capture": false, "stress": true, "multiSystem": false }
  }
}
```

- `features.capture=false`：流量接入（需求3）預留位，前端展示「未啟用」狀態。
- `systems[].readOnly`：EBP-CL 可讀寫，其餘系統只讀（需求9 權限展示）。

### GET /api/dashboard/summary

```json
{ "code": 0, "message": "ok", "data": {
  "totalCases": 10, "totalRuns": 22, "passRate": 32,
  "pendingReviews": 1, "coveredTxnCodes": 10, "runningBatch": null
} }
```

### GET /api/dashboard/charts?type=status-distribution

```json
{ "code": 0, "message": "ok", "data": {
  "labels": ["DRAFT", "PENDING", "APPROVED", "REJECTED"],
  "series": [0, 1, 8, 1]
} }
```

`type=execution-trend` 返回多序列折線（通過/差異/失敗 × 近 7 日）；`type=module-distribution` 返回各模組案例數。

### GET /api/cases

查詢參數：`txnCode`（交易碼精確）、`keyword`（名稱模糊）、`status`（DRAFT|PENDING|APPROVED|REJECTED）、`module`、`page`、`pageSize`。列表項內聯最近一次運行：

```json
{ "code": 0, "message": "ok", "data": {
  "list": [
    {
      "id": "C0001", "txnCode": "ACCT1001", "name": "帳戶查詢 — 基本成功",
      "systemId": "EBP-CL", "module": "帳戶查詢", "stateType": "STATELESS",
      "status": "APPROVED", "precondition": "", "profile": "pass",
      "hostInput": { "rawXml": "<?xml version=\"1.0\"…" },
      "newInput": {
        "url": "https://newapi.boc.com.hk/ebp/api/v1/accountInquiryRequest/ACCT1001",
        "method": "POST",
        "headers": [
          { "name": "API-Key", "value": "boc-ebp-2026-demo" },
          { "name": "Content-Type", "value": "application/json" },
          { "name": "X-Client-Id", "value": "EBP-CL" }
        ],
        "body": "{ \"header\": { … }, \"body\": { … } }"
      },
      "lastRun": {
        "id": "R0029", "verdict": "PASS", "runBy": "測試工程師 陳",
        "startedAt": "2026-08-26T03:30:00.000Z", "summary": { "total": 0, "added": 0, "deleted": 0, "modified": 0, "low": 0, "medium": 0, "high": 0 }
      }
    }
  ],
  "total": 10, "page": 1, "pageSize": 10
} }
```

### GET /api/cases/{id}

案例詳情，含 `auditLogs: [{ id, caseId, action, from, to, operator, at, comment }]`。

### POST /api/cases/ai-generate（需求1：主控 XML → 新系統案例）

請求：`{ "hostXml": "<Tx>…</Tx>", "systemId": "EBP-CL" }`

響應（Mock 為確定性轉換器；真實環境僅替換此實現，契約不變）：

```json
{ "code": 0, "message": "ok", "data": { "newInput": {
  "url": "https://newapi.boc.com.hk/ebp/api/v1/tx/ACCT1001",
  "method": "POST",
  "headers": [ { "name": "API-Key", "value": "boc-ebp-2026-demo" }, … ],
  "body": "{ \"header\": { \"txnCode\": \"ACCT1001\" }, \"body\": { \"acctNo\": \"123\" } }"
} } }
```

- URL 依 `/api/config` 的 `urlTemplate` 拼接（固定段 + 變數段），請求頭取 `defaultHeaders`。
- 前端支持生成後微調與重新生成（保留生成歷史）。

### POST /api/cases/{id}/run（需求4：執行與字段級 diff）

執行 1.5–3s 後返回完整 Run：

```json
{ "code": 0, "message": "ok", "data": {
  "id": "R0034", "caseId": "C0002", "batchId": null, "type": "SINGLE",
  "verdict": "DIFF",
  "stateNote": null,
  "diff": {
    "summary": { "total": 1, "added": 0, "deleted": 0, "modified": 1, "low": 1, "medium": 0, "high": 0 },
    "items": [
      {
        "path": ["Header", "TxnTime"],
        "kind": "modified",
        "hostValue": "2026-08-26T09:30:00.000+08:00",
        "newValue": "2026-08-26T01:30:00.000Z",
        "plausibility": "FORMAT",
        "suspicion": "low",
        "precisionRisk": false,
        "reason": "僅時間表示方式不同：2026-08-26T09:30:00.000+08:00 vs 2026-08-26T01:30:00.000Z"
      }
    ]
  },
  "hostResult": { "httpStatus": 200, "latencyMs": 42, "rawBody": "…" },
  "newResult":  { "httpStatus": 200, "latencyMs": 11, "rawBody": "…" },
  "runBy": "測試工程師 陳", "startedAt": "…", "finishedAt": "…"
} }
```

- `kind`: `added` | `deleted` | `modified`
- `plausibility`: `FORMAT`（格式性）| `STRUCTURAL`（結構性）| `DATA`（資料性）
- `suspicion`: `low` | `medium` | `high`；`stateType=STATEFUL` 時 DATA 差異降為 medium，理由注明「可能源於前置狀態，建議核對前置條件重跑」
- 執行與前端展示共用同一份 `shared/diff` 引擎，保證口徑一致

### POST /api/batch-runs（需求6：批量回歸）

請求：`{ "caseIds": ["C0001", "C0002", "C0003"] }`

```json
{ "code": 0, "message": "ok", "data": {
  "id": "SR0040", "name": "批量回歸 08-26T03:30",
  "caseIds": ["C0001", "C0002"], "status": "running",
  "progress": { "total": 2, "finished": 0, "pass": 0, "diff": 0, "fail": 0 },
  "caseResults": [ { "caseId": "C0001", "txnCode": "ACCT1001", "status": "pending" } ],
  "runBy": "測試工程師 陳", "startedAt": "…", "finishedAt": null
} }
```

`status`: `running` → `done`。`caseResults[].status`: `pending` → `PASS` | `DIFF` | `FAIL`。前端每 900ms 輪詢。

### GET /api/stress/runs/{id}

```json
{ "code": 0, "message": "ok", "data": {
  "id": "SR0043", "planId": "SP0033", "status": "done",
  "summary": { "tps": 313, "avgLatencyMs": 216, "p50": 220, "p90": 252, "p95": 254, "p99": 259, "errorRate": 1.58, "totalRequests": 18769 },
  "series": [ { "tSec": 1, "tps": 34, "errorRate": 0.42, "latencyP50": 131 }, … ]
} }
```

壓測時長 = 計劃 `durationSec` 秒，每秒一個採樣點（ramp-up → 峰值 → 波動）。

### GET/PUT /api/config

```json
{ "code": 0, "message": "ok", "data": {
  "systemId": "EBP-CL", "readOnly": false,
  "urlTemplate": [
    { "kind": "fixed", "value": "https://newapi.boc.com.hk" },
    { "kind": "fixed", "value": "ebp" },
    { "kind": "var", "value": "api" },
    { "kind": "var", "value": "v1" }
  ],
  "defaultHeaders": [
    { "name": "API-Key", "value": "boc-ebp-2026-demo", "enabled": true, "secret": true },
    { "name": "Content-Type", "value": "application/json", "enabled": true, "secret": false },
    { "name": "X-Client-Id", "value": "EBP-CL", "enabled": true, "secret": false }
  ],
  "diffRules": {
    "arrayMatchMode": "index", "arrayMatchKeys": {},
    "ignoreFields": ["RespMsg"],
    "dynamicRegex": [".*(tStamp|nonce|traceId|requestId)$"],
    "numeric": "strict", "longNumberGuard": 15, "timeNormalize": true,
    "attrMerge": true, "namespaceInsensitive": true, "emptyEqualsNull": false,
    "wrapIgnoreKeys": [], "collapseSingleArray": true
  }
} }
```

`PUT /api/config` 接受部分更新（`{urlTemplate?}`, `{defaultHeaders?}`, `{diffRules?}`），與現有配置合併。修改即時影響後續 AI 生成與執行比對。

### POST /api/cases/{id}/review

請求：`{ "action": "approve" | "reject", "comment": "審核意見" }`
- 自動寫入 AuditLog（`ALCxxxx`），案例狀態流轉 `PENDING → APPROVED / REJECTED`。

### GET /api/audit-logs?caseId=

```json
{ "code": 0, "message": "ok", "data": [
  { "id": "ALC0001", "caseId": "C0001", "action": "approve", "from": "PENDING", "to": "APPROVED",
    "operator": "審核專員 李", "at": "2026-08-18T03:30:00.000Z", "comment": "審核通過，案例有效" }
] }
```

---

## 前端切換真實後端

`public/js/api.js` 單點決定請求地址：

```js
// public/env.js（複製自 env.example.js，勿提交）
window.APP_CONFIG = { apiBase: 'https://your-real-backend.example.com' }
```

不建立 `env.js` 即走內建 Mock。切換後按本清單實現的後端可直接對接；`{code, message, data}` 包裹與分頁形狀為硬性約定。
