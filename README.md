# 中銀香港智能化API測試工作台（前端 + 後端）

測試人員錄入銀行主機系統（XML 報文）測試案例 → AI 自動生成對應新系統（HTTP/JSON）案例（可人工微調）→ 執行後對兩系統輸出做**欄位級差異比對並高亮**，支持人工審核、批量回歸、壓力測試設計、Dashboard 與 Word 導出。

**前端零依賴**：HTML5 + 原生 CSS（design tokens）+ 原生 JS（ES Modules），無任何 npm 套件；Node.js ≥ 18 僅作靜態/Mock 伺服器。開箱可演示，可切換真實後端（`backend/`，Spring Boot 3.3.5）。

## 快速開始（開發模式）

```bash
node server.js        # 或 npm start → http://localhost:8080（靜態 + /api/* Mock）
```

後端（見下「編譯與部署」）啟動後，建立 `public/env.js` 即可全量切到真實後端：

```bash
echo 'window.APP_CONFIG = { apiBase: "http://localhost:8081" };' > public/env.js
```

- 靜態頁面與 `/api/*` Mock 由同一 Node 進程提供（`PORT=8081 node server.js` 可換埠）
- `node --test`（或 `npm test`）：diff 引擎回歸測試（JS 28 項；Java 端同源單測見後端）

## 編譯與部署

### 前端（純靜態，無編譯）

前端無任何構建步驟，`public/` 即部署產物，拷貝到任意靜態伺服器即可。

**開發 / 演示**：`node server.js`（8080，內建 Mock）。

**生產部署（nginx 示例）**：

```nginx
server {
    listen 80;
    root /opt/workbench/public;          # 前端靜態目錄

    # 錄入頁依賴 /shared/*（XML 解析器），需另指到項目根目錄的 shared/
    location /shared/ {
        alias /opt/workbench/shared/;
    }

    location / {
        try_files $uri $uri/ /404.html;
    }
}
```

> 若不放 /shared/ 或使用無法配置 alias 的靜態伺服器，改用 `node server.js` 託管亦可（mock 部分不會被前端調用）。

**連接後端**：在 `public/` 放 `env.js`（已被 .gitignore 忽略，含機密地址不提交）：

```js
window.APP_CONFIG = { apiBase: 'http://<後端主機>:8081' };
```

11 個 HTML 已統一 `<script src="/env.js">`；不建該文件則請求走同源（Mock 或純靜態 404）。

### 後端（Maven，Java 17+）

環境要求：JDK 17+（JDK 23 已驗證）、Maven 3.8+。詳見 `backend/README.md`。

```bash
cd backend

# 開發運行（H2 記憶體庫，零安裝；重啟即重置種子）
mvn spring-boot:run

# 編譯打包 → target/apitest-backend-1.0.0.jar
mvn clean package

# 部署運行
java -jar target/apitest-backend-1.0.0.jar

# 連接 MySQL 8 / TDSQL（profile 見 application-mysql.yml）
java -jar target/apitest-backend-1.0.0.jar --spring.profiles.active=mysql
```

- 端口 8081（`application.yml` 可改）；CORS 已 allow-all，供前端跨域調用
- `schema.sql` 隨啟動自動建表（MySQL/H2 通用，JSON 一律 LONGTEXT）
- 除錯用資料庫瀏覽器：`http://localhost:8081/h2-console`（JDBC URL `jdbc:h2:mem:apitest;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;NON_KEYWORDS=MONTH`，sa / 空密碼）
- 測試：`mvn test`（diff 引擎 28 單測）

### 部署拓撲

```
瀏覽器
 ├─ http://host:80       前端（nginx / public 靜態）
 └─ http://host:8081     /api/*（Spring Boot，數據存 H2/MySQL/TDSQL）
```

前端 `env.js` 的 `apiBase` 即指向後端地址；後端 CORS allow-all，無需代理。若後端不在瀏覽器可直達的網段，可在 nginx 加 `/api/` 反代並將 `apiBase` 留空（同源請求）。

## 頁面

| 頁面 | 地址 | 功能 |
|---|---|---|
| 儀表板 | `/index.html` | KPI、狀態環圖/模組條形/7 日趨勢、**按業務模組卡片網格**（需求1，點擊跳轉模組篩選）、最近運行、待審核、批量運行橫幅 |
| 測試案例 | `/cases.html` | 交易碼搜索/多條件篩選（含**模組下拉**，需求7）、內聯最近運行結果（需求5）、勾選批量重跑（需求6）、批量 Word 導出、流量接入預留按鈕（需求3） |
| 業務模塊 | `/modules.html` | **業務模組獨立維護**（需求3）：名稱/代碼/描述 CRUD，顯示各模組案例數 |
| 案例錄入 | `/case-edit.html` | **對比模式 / 獨立 HTTP 模式**（需求4）+ **報文格式可選 XML/JSON**；主控 XML 輸入 → **AI 生成**新系統 HTTP/JSON 案例（需求1）；**原始報文 / 表單模式**切換 —— 行式字段級增刪改（需求6）；**預定義業務模組下拉**（需求7） |
| 案例詳情 | `/case-detail.html` | **配置信息卡**（需求10：當前環境/接口 URL/方法/請求頭/報文）、Tab：本次結果（**執行過程步驟時間線** + 欄位級 diff 高亮 + 合理性評估，需求2/4）/ 運行歷史 / 審核記錄；審核通過/駁回；單條 Word 導出 |
| 壓力測試 | `/stress.html` | 計劃 CRUD（並發/時長/ramp-up）、**計劃詳情抽屜**（需求8：配置+審批+最近運行+曲線）、**審批模式**（需求11：pending→approved/rejected，未批准不可啟動）、TPS/延遲/錯誤率曲線 |
| 系統配置 | `/config.html` | **環境變量**（需求9：SIT1/SIT3/USMK/USMF，全域當前環境影響 AI 生成 URL）、URL 模板（固定段只讀 + 變數段可編輯）、默認請求頭、diff 比對規則 |
| Diff 自測 | `/test-diff.html` | 瀏覽器內 diff 引擎自測面板 |

## 演示走查（建議路徑）

1. **Dashboard**：檢視 KPI 與圖表、**按業務模組卡片網格**（點擊卡片跳轉該模組案例列表）
2. **業務模塊維護**：`modules.html` 新建/編輯/刪除模組（如「帳戶查詢」「轉賬」）
3. **錄入 + AI 生成**：`case-edit.html` → 選「對比模式」+ XML 格式 → 貼入主控 XML → 「AI 生成新系統案例」→ 微調 → 保存；也可切「獨立 HTTP 模式」直接定義請求；**表單模式**下逐字段增/刪/改後切回原始報文查看序列化結果
4. **審核**：`cases.html` 篩選「待審核」→ 進入詳情 → 審核通過/駁回
5. **執行 + diff**：詳情頁「執行」→ 檢視**執行過程時間線**與 verdict、diff 清單（新增/刪除/修改、可疑度、機器理由）→ 運行歷史回看任一運行；配置信息卡可查看該案例調用的接口 URL 與當前環境
6. **批量回歸**：`cases.html` 勾選多條 → 「批量重跑」→ 進度抽屜逐案例結果
7. **導出**：單條或批量導出 Word（`.doc`，中文兼容）
8. **壓測 + 審批**：`stress.html` → 新建計劃（狀態「待審批」→ 啟動按鈕禁用）→ 點計劃名/詳情 → 抽屜中「批准」→ 再啟動 → 曲線與 8 項 KPI
9. **配置**：`config.html` 切換當前環境（SIT1/SIT3/USMK/USMF）→ 重新 AI 生成，觀察 URL 前綴變化；調整 URL 模板/請求頭/diff 規則觀察影響

## 切換真實後端

```bash
cp public/env.example.js public/env.js
# 編輯 public/env.js：設定 apiBase（真實後端地址）
```

- 不建立 `env.js` → 內建 Mock（`/api/*`，含模擬延遲）
- 建立後所有請求改走真實後端；契約見 [docs/API-LIST.md](docs/API-LIST.md)
- `env.js` 可能含機密（API 地址），不應提交

## 架構

```
server.js             # 零依賴伺服器：靜態 + /api/* Mock（node:http）
shared/diff/          # ★ 環境無關 diff 引擎（瀏覽器與 Node 共用同一份）
  xml-parser.js       #   手寫遞歸下降 XML 解析器
  normalize.js        #   XML/JSON → 拍平 Map<pathKey, Leaf>
  comparators.js      #   比較規則（時間/數值/動態欄位/數組對齊…）
  diff.js             #   compare() 主入口 + 合理性分級 + 機器理由
  __tests__/          #   node --test 回歸（含 fixtures）
mock/                 # 僅 Node 端
  db.js               #   內存數據庫
  seed.js             #   種子：10 案例覆蓋全部 diff 場景 + 業務模組 + 壓測計劃 + 環境變量 + 配置
  routes.js           #   API 路由表（對齊 API-LIST）
  generators.js       #   AI 生成模擬 / 執行模擬 / 壓測曲線
public/
  *.html              # 8 頁 + 404
  css/                #   base（design tokens）/ components / pages
  js/
    api.js            #   fetch 封裝，apiBase 單點切換
    util.js           #   esc / el（XSS 安全 DOM 輔助）/ 徽標 / LCS
    layout.js         #   側邊欄 + 頂欄共享佈局
    components.js     #   toast / modal / confirm / pagination
    views/            #   diff-view（高亮清單）/ charts（手繪 SVG）/ word-export / field-editor（行式字段編輯器）
    pages/            #   每頁一個入口模塊
```

**一致性設計**：Mock 的執行端點與前端 diff 展示呼叫**同一份 `shared/diff`**，確保「執行結果口徑 = 展示口徑」。配置頁的 diff 規則即引擎輸入，改動即時生效。

## 核心：欄位級 diff（需求4）

主控 XML 與新系統 JSON 經統一歸一化（屬性 `@attr`、重複標籤自動數組化、命名空間保留）後拍平為 key-path 樹，套用可配置規則（時間格式歸一、數值精度防浮點、動態欄位正則、忽略欄位、數組主鍵對齊…）逐欄位比較，輸出：

- `kind`：新增（綠）/ 刪除（紅）/ 修改（黃）
- `plausibility`：格式性 / 結構性 / 資料性
- `suspicion`：低 / 中 / 高 —— 有狀態案例的資料差異降為「中」，提示「可能源於前置狀態，建議核對前置條件重跑」
- 機器生成的中文理由，前端**只給評估不給結論**，需人工確認（需求4 原則）

## 安全

- 所有用戶輸入經 `esc()` 轉義；高亮用 DOM class 而非 innerHTML 拼接原始報文（防 XSS）
- 靜態服務防目錄穿越、404 兜底
- Word 導出加 BOM + `<meta charset>` 防中文亂碼

## 版本

v1.2.0（示範環境）— Mock 模式 · 零依賴 + Java 後端（`backend/`，Spring Boot 3.3.5 / MyBatis-Plus 3.5.7 / H2 或 MySQL 8 / TDSQL）。新增：依 `docs/API-LIST.md` 全量實現後端接口（契約與 Mock 逐字對齊）、差異引擎 Java 移植（28 單測）、種子數據移植、前後端一鍵聯動（`public/env.js`）。

v1.1.0 — 儀表板模組卡片（需求1）、案例詳情執行過程+配置卡（需求2/10）、業務模組獨立維護（需求3）、對比/HTTP 雙模式 + 報文格式可選（需求4/5）、行式字段編輯器（需求6）、模組下拉（需求7）、壓測詳情抽屜（需求8）、環境變量（需求9）、壓測審批（需求11）。需求對照與實現細節見 `docs/API-LIST.md`。
