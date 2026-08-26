# 中銀香港智能化 API 測試工作台 — 後端

與前端（`public/`）配套的 Java 後端，逐一實現 `docs/API-LIST.md` 的全部端點，行為與內建 Mock 伺服器（`server.js`）一致（響應包裹、錯誤訊息、狀態機、延遲節奏均對齊）。

## 技術棧

| 項目 | 版本 | 說明 |
|---|---|---|
| JDK | 17（`maven.compiler.release=17`） | 已在 JDK 23 上驗證可編譯運行 |
| Spring Boot | 3.3.5 | spring-boot-starter-web |
| MyBatis-Plus | mybatis-plus-spring-boot3-starter 3.5.7 | 附帶 JacksonTypeHandler 存 JSON 欄位 |
| 資料庫 | H2（預設，MySQL 兼容模式） / MySQL 8 / TDSQL | 見下方「資料庫」 |
| Lombok | 1.18.42 | 需 compiler-plugin `<proc>full</proc>`（JDK 23+ 隱式停用 annotation processing） |

## 快速開始

```bash
cd backend
mvn spring-boot:run          # 啟動於 http://localhost:8081
```

零配置：預設使用 H2 記憶體庫（`MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=MONTH`），
啟動時自動建表（`schema.sql`）並載入與 Mock 一致的種子數據（`DataSeeder`），無需安裝資料庫。

### 前端聯動

後端啟動後，前端根目錄新建 `public/env.js`（會被 `public/js/api.js` 讀取並覆蓋默認 `apiBase`）：

```js
window.APP_CONFIG = { apiBase: 'http://localhost:8081' };
```

`/public` 以任意靜態伺服器打開（如 `python3 -m http.server 8000`）。驗證完畢刪除 `env.js` 即可還原 Mock 模式。

### 連接 MySQL 8 / TDSQL

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=mysql
```

`src/main/resources/application-mysql.yml` 中設定連線（`spring.datasource.url/username/password`）。
`schema.sql` 的 DDL 兩者通用（JSON 欄位一律 LONGTEXT）。

## 資料庫注意事項

- **`month` 是 H2 保留字（MySQL 非保留）**：列名直接用，H2 透過 JDBC URL `NON_KEYWORDS=MONTH` 放行；DDL 中仍以反引號標註。若在 MySQL 上出現語法錯誤可去除反引號。
- **`from`/`to` 兩庫皆為保留字**：實體欄位命名 `fromStatus/toStatus`（列名 `from_status/to_status`），JSON 輸出用 `@JsonProperty("from"/"to")` 保持前端契約 `{ from, to }`。
- **時間一律 ISO-8601 UTC 字串**（與 Mock 一致），避免時區換算口徑差異；`daysAgo` 系列種子時間為本地時區 09:30 的 UTC 表示。

## 目錄結構

```
src/main/java/com/boc/apitest/
├── ApiTestApplication.java      # 入口（@MapperScan）
├── common/                      # ApiResponse / BizException / GlobalExceptionHandler / PageResult / TimeUtil
├── config/                      # WebConfig（CORS allow-all）/ SimulatedDelayFilter / DataSeeder
├── controller/                  # 9 個 Controller（與 API-LIST.md 路由一一對應）
├── diff/                        # 差異引擎（shared/diff/*.js 移植）：comparator、parser、xml/json、DiffEngine
├── entity/                      # Case / Run / Misc（模組/案例類型/版本/系統/審計/配置/元資料）/ DiffModels
├── mapper/                      # MyBatis-Plus Mapper 統一出口（Mappers 類）
└── service/                     # Config / Meta / Reference / Case / Dashboard / Stress / Batch / Ai / Generator / Seq / AsyncRunner
```

## 端點一覽

完整契約見 `../docs/API-LIST.md`（本後端逐項實現）：

| 分類 | 端點 |
|---|---|
| 元資料 | `GET /api/meta/context`、`GET /api/systems` |
| 儀表板 | `GET /api/dashboard/summary`、`recent-runs`、`pending-reviews`、`charts?type=`（status-distribution / module-distribution / execution-trend / **module-cards**） |
| 案例中心 | `GET/POST /api/cases`、`GET/PUT/DELETE /api/cases/{id}`、`POST /api/cases/{id}/review`、`/run`、`GET /api/cases/{id}/runs`、`POST /api/cases/ai-generate`、`GET /api/cases/export-word`（預留） |
| 運行 | `GET /api/runs/{id}`（含 diff.items / steps）、`GET /api/audit-logs?caseId=` |
| 批量 | `POST /api/batch-runs`（非同步）、`GET /api/batch-runs/{id}` |
| 業務模塊 / 案例類型 | `GET/POST/PUT/DELETE /api/modules`、`/api/case-types`（含刪除保護與統計） |
| 版本號 | `GET /api/versions`（統計）、`POST /api/versions`（YYYYMM+A/Z，重複返回 4000）、`DELETE /api/versions/{id}` |
| 壓測 | `GET/POST /api/stress/plans`、`GET/PUT/DELETE /api/stress/plans/{id}`、`POST …/{id}/review`（approve/reject）、`POST …/{id}/run`、`GET /api/stress/runs/{id}` |
| 配置 | `GET/PUT /api/config`（partial merge：diffRules 欄位級、environments 整值替換且保證恰好一個 current、AI apiKey 掩碼值不落庫） |
| AI | `POST /api/ai/analyze`（remote 模式 → 外部 API；失敗自動回退本地規則並附註說明） |

## 種子數據（DataSeeder）

與 `server.js` 種子完全一致，一次性載入：

- **版本號**：36 個月 × 集中(A)/非集中(Z) = 72 條（V0001–V0072，`202608A` → `202907Z`，按月份降序）
- **業務模塊 / 案例類型**：M01–M05 / CT01–CT04（顯式 id）
- **案例**：C0073–C0082 共 10 條（含 1 條 http 模式、1 條 UAT、profile 覆蓋 pass/diff/fail），5 個模組各 2 條
- **審計日誌**：9 條 `AL{C}` 系列（create/approve/reject/update）
- **運行記錄**：R0083–R0104 共 22 條（近 7 日內），案例 `lastRun` 指向各自最早的運行
- **壓測**：3 個計劃 SP0105（pending）/ SP0107（pending）/ SP0108（approved + 已完成），1 條壓測運行 SR0106（已完成，90870 請求）
- **配置/元資料/系統**：與前端 Mock 相同

> 種子執行序與 id 前綴消耗必須與 Mock 一致（全局序號 seq 依插入順序消耗），已實測逐項比對一致。

## 模擬延遲

`SimulatedDelayFilter` 依路徑延遲（可在 `application.yml` `app.delay-ms` 調整，`app.delay.enabled=false` 關閉）：
查詢類 80–200ms、AI 生成 1.2s、單條執行 1.5s+隨機 1.5s、壓測 1.6s、批量 300ms。

## 測試

```bash
mvn test
```

`src/test/java/com/boc/apitest/diff/DiffEngineTest.java`：差異引擎 28 個單測（對應 `shared/diff/__tests__` 的 JS 測試，verdict 判定與 plausibility/suspicion 標注一致）。
