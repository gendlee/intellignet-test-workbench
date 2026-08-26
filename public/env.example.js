/**
 * 環境配置範本（切換真實後端）
 *
 * 使用方式：複製本檔為 public/env.js 並取消註解設定值。
 * env.js 應加入 .gitignore（可能含機密資訊）。
 *
 * - 不建立 env.js → 使用內建 Mock 伺服器（npm start，同源 /api/*）
 * - 建立 env.js 設定 apiBase → 前端所有請求改走真實後端
 */
window.APP_CONFIG = {
  // apiBase: 'https://your-real-backend.example.com',
  // apiBase: 'http://localhost:3000',
}
