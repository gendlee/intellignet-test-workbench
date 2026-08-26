/**
 * 共享佈局：側邊欄 + 頂欄
 * 每個頁面在 <body> 中放置 <div class="app-shell">，由本模組注入側邊欄與頂欄。
 * 當前頁面識別：<body data-page="cases"> 或取 location.pathname。
 */

import { get } from './api.js'
import { esc } from './util.js'

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  cases: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5h12M9 12h12M9 19h12"/><circle cx="4" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="4" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>',
  stress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18"/><path d="M6 20v-6M11 20V8M16 20v-10M21 20V4"/></svg>',
  modules: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  'case-edit': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  'test-diff': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8.5" height="18" rx="1.5"/><rect x="12.5" y="3" width="8.5" height="18" rx="1.5"/><path d="M7 9l-2 2 2 2M17 9l-2 2 2 2"/></svg>',
  'case-center': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 12h.01M16 12h.01M12 16h.01M16 16h.01"/></svg>',
  'test-tools': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-8 8l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 8-8z"/></svg>',
  versions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>',
  config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>',
}

const NAV = [
  { key: 'dashboard', href: '/index.html', label: '儀表板' },
  { key: 'cases', href: '/cases.html', label: '測試案例' },
  {
    key: 'case-center', label: '案例中心',
    children: [
      { key: 'case-edit', href: '/case-edit.html', label: '案例錄入' },
      { key: 'modules', href: '/modules.html', label: '業務模塊' },
      { key: 'versions', href: '/versions.html', label: '版本管理' },
    ],
  },
  { key: 'stress', href: '/stress.html', label: '壓力測試' },
  {
    key: 'test-tools', label: '測試工具',
    children: [
      { key: 'test-diff', href: '/test-diff.html', label: 'Diff 引擎自測' },
    ],
  },
  { key: 'config', href: '/config.html', label: '系統配置' },
]

const TITLES = {
  dashboard: '儀表板',
  cases: '測試案例管理',
  'case-edit': '案例錄入 / 編輯',
  'case-detail': '案例詳情',
  modules: '業務模塊',
  versions: '版本管理',
  stress: '壓力測試設計',
  config: '系統配置',
  'test-diff': 'Diff 引擎自測',
}

/** 父頁面映射：有父頁面的頁面在頂欄右側顯示「← 返回」 */
const PARENTS = {
  'case-detail': '/cases.html',
  'case-edit': '/cases.html',
}

let metaCache = null

export async function loadMeta(force = false) {
  if (!force && metaCache) return metaCache
  try {
    metaCache = await get('/api/meta/context')
  } catch {
    metaCache = { currentUser: { name: '—', role: '' }, currentSystem: '', features: {} }
  }
  return metaCache
}

export function initLayout() {
  const shell = document.querySelector('.app-shell')
  if (!shell) return
  const page = document.body.dataset.page || location.pathname.split('/').pop().replace('.html', '') || 'dashboard'

  const brand = `
    <div class="brand">
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#B3002D"/>
        <text x="16" y="22" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" font-family="-apple-system, PingFang TC, sans-serif">API</text>
      </svg>
      <div>
        <div class="brand-name">智能化 API 測試工作台</div>
        <div class="brand-sub">中銀香港</div>
      </div>
    </div>`

  const navItem = (n) => `<a href="${n.href}" class="${n.key === page ? 'active' : ''}"><span class="nav-icon">${ICONS[n.key]}</span>${n.label}</a>`
  const nav = `<nav>${NAV.map((n) => {
    if (!n.children) return navItem(n)
    const open = n.children.some((c) => c.key === page)
    return `
      <div class="nav-group${open ? ' open' : ''}" title="展開 / 收合" onclick="this.classList.toggle('open')">
        <span class="nav-icon">${ICONS[n.key]}</span>${n.label}<span class="g-arrow">▶</span>
      </div>
      <div class="nav-sub">${n.children.map((c) => navItem(c)).join('')}</div>`
  }).join('')}</nav>`

  const foot = `
    <div class="sidebar-foot">
      版本 v1.0.0（示範環境）<br>
      Mock 模式 · 零依賴
    </div>`

  const sidebar = document.createElement('aside')
  sidebar.className = 'sidebar'
  sidebar.innerHTML = brand + nav + foot

  const main = document.createElement('div')
  main.className = 'main'
  const topbar = document.createElement('header')
  topbar.className = 'topbar'
  topbar.innerHTML = `
    <div class="page-title">${esc(TITLES[page] || '')}</div>
    <span class="spacer"></span>
    ${PARENTS[page] ? `<a class="back-btn" href="${PARENTS[page]}">← 返回</a>` : ''}
    <span class="sys-tag" id="sys-tag">…</span>
    <div class="user"><span class="avatar" id="user-avatar">…</span><span id="user-name">…</span></div>`
  main.append(topbar)

  // 將既有內容搬入 .page
  const existing = shell.innerHTML
  shell.innerHTML = ''
  shell.append(sidebar, main)
  const pageEl = document.createElement('div')
  pageEl.className = 'page'
  pageEl.id = 'page'
  pageEl.innerHTML = existing
  main.append(pageEl)

  // 頂欄元資料（失敗時保留占位）
  loadMeta().then((m) => {
    const sys = document.getElementById('sys-tag')
    if (sys) sys.textContent = m.currentSystem || '—'
    const av = document.getElementById('user-avatar')
    const nm = document.getElementById('user-name')
    if (av) av.textContent = (m.currentUser?.name || '?').slice(0, 1)
    if (nm) nm.textContent = m.currentUser?.name || '—'
  }).catch(() => {})
}

/** 頁面內容容器（layout 注入後取用） */
export function pageEl() {
  return document.getElementById('page')
}
