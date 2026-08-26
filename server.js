/**
 * 零依賴開發/演示伺服器（Node ≥ 18，僅用內建模組）
 * - 靜態服務：public/（含 /shared/* diff 引擎與瀏覽器共用）
 * - Mock API：/api/* → mock/routes.js（模擬延遲、統一響應包裹、CORS）
 *
 * 啟動：npm start  （PORT=8080 環境變數可改）
 * 切換真實後端：public/env.js 設定 window.APP_CONFIG.apiBase
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDB } from './mock/db.js'
import { seedDB } from './mock/seed.js'
import { buildRoutes } from './mock/routes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')
const PORT = Number(process.env.PORT) || 8080

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/* ---------- 初始化 Mock 資料 ---------- */
const db = createDB()
seedDB(db)
const routes = buildRoutes(db)

/* ---------- 工具 ---------- */

function sendJSON(res, status, payload, delay = 0) {
  const body = JSON.stringify(payload)
  setTimeout(() => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end(body)
  }, delay)
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 2 * 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** API 模擬延遲（ms）：查詢 80–200、AI 生成 1200、執行 1500–3000 */
function apiDelay(url) {
  if (url.includes('/ai-generate')) return 1200
  if (url.includes('/run')) return 1500 + Math.floor(Math.random() * 1500)
  if (url.includes('/batch-runs') && url.endsWith('/batch-runs')) return 300
  return 80 + Math.floor(Math.random() * 120)
}

/* ---------- 請求處理 ---------- */

async function handleAPI(req, res, url, pathname) {
  const method = req.method
  const query = new URLSearchParams(url.split('?')[1] || '')
  const body = ['POST', 'PUT'].includes(method) ? await readBody(req) : {}

  // 路由匹配（順序即優先級）
  for (const r of routes) {
    if (r.method !== method) continue
    const m = pathname.match(r.re)
    if (!m) continue
    try {
      const result = r.h(query, m, body)
      // 支援 async handler
      const payload = result && typeof result.then === 'function' ? await result : result
      if (payload && typeof payload.code === 'number' && payload.code !== 0) {
        return sendJSON(res, payload.code === 4040 ? 404 : 400, payload, 60)
      }
      return sendJSON(res, 200, payload, apiDelay(pathname))
    } catch (e) {
      return sendJSON(res, 500, { code: 5000, message: `伺服器錯誤：${e.message}` })
    }
  }
  return sendJSON(res, 404, { code: 4040, message: `API 不存在：${method} ${pathname}` })
}

function handleStatic(req, res, url, pathname) {
  // /shared/* 由專案根提供（diff 引擎供瀏覽器 ES Module 載入），其餘走 public/
  const root = pathname.startsWith('/shared/') ? __dirname : PUBLIC_DIR
  // 目錄穿越防護
  let filePath = path.normalize(path.join(root, pathname))
  if (!filePath.startsWith(root)) {
    filePath = path.join(PUBLIC_DIR, '404.html')
  } else if (filePath === PUBLIC_DIR || filePath === PUBLIC_DIR + path.sep) {
    filePath = path.join(PUBLIC_DIR, 'index.html')
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (pathname.includes('.')) return sendJSON(res, 404, { code: 4040, message: '檔案不存在' })
      fs.readFile(path.join(PUBLIC_DIR, '404.html'), (e2, d2) => {
        res.writeHead(e2 ? 404 : 404, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(e2 ? '404' : d2)
      })
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/'
  const pathname = decodeURIComponent(url.split('?')[0])

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    return res.end()
  }
  if (pathname.startsWith('/api/')) return handleAPI(req, res, url, pathname)
  // /shared/* 放行（diff 引擎供瀏覽器 ES Module 載入）
  return handleStatic(req, res, url, pathname)
})

server.listen(PORT, () => {
  console.log('')
  console.log('  中銀香港智能化API測試工作台 — 前端（零依賴 Mock 模式）')
  console.log(`  http://localhost:${PORT}`)
  console.log('  靜態目錄：public/    Mock API：/api/*    diff 引擎：/shared/diff/*')
  console.log('  切換真實後端：複製 public/env.example.js 為 public/env.js 並設定 apiBase')
  console.log('')
})
