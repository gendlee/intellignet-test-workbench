/**
 * 批量重跑：啟動 + 側滑抽屜進度（輪詢 GET /api/batch-runs/{id}）
 * 每案例一行：交易碼 + 狀態（待執行/執行中/通過/有差異/失敗）
 */

import { get, post } from '../api.js'
import { el } from '../util.js'
import { toast } from '../components.js'

/**
 * @param {string[]} caseIds 選中的案例 ID
 * @returns {Promise<void>} 批次完成（或使用者關閉抽屜）
 */
export async function startBatchWithDrawer(caseIds) {
  if (!caseIds.length) return toast('請先勾選案例', 'warn')
  let batch
  try {
    batch = await post('/api/batch-runs', { caseIds })
  } catch (e) {
    return toast(e.message, 'err')
  }
  toast(`批量回歸已啟動：${batch.progress.total} 個案例`, 'ok', 1800)

  // 抽屜
  const mask = el('div', { class: 'drawer-mask' })
  const drawer = el('div', { class: 'drawer' })
  const head = el('div', { class: 'drawer-head' }, [
    el('span', { text: '批量回歸執行中' }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'modal-close', text: '✕', onclick: close }),
  ])
  const body = el('div', { class: 'drawer-body' })
  const foot = el('div', { class: 'drawer-foot' }, [
    el('button', { class: 'btn', text: '隱藏', onclick: close }),
  ])
  drawer.append(head, body, foot)
  document.body.append(mask, drawer)

  function close() {
    mask.remove()
    drawer.remove()
  }

  // 逐案例行
  const rows = new Map()
  const listBox = el('div', { class: 'batch-per-case' })
  body.append(
    el('div', { class: 'progress-track' }, [el('div', { class: 'progress-fill', id: 'batch-fill' })]),
    el('div', { class: 'progress-nums', id: 'batch-nums' }),
    el('div', { class: 'section-title', style: 'margin-top:18px' }, [el('span', { text: '執行進度' })]),
    listBox,
  )

  const poll = setInterval(async () => {
    try {
      const b = await get(`/api/batch-runs/${batch.id}`)
      render(b)
      if (b.status === 'done') {
        clearInterval(poll)
        finish(b)
      }
    } catch {
      /* 暫時性失敗，下輪再試 */
    }
  }, 900)

  function render(b) {
    const p = b.progress
    const pct = Math.round((p.finished / Math.max(1, p.total)) * 100)
    document.getElementById('batch-fill').style.width = `${pct}%`
    document.getElementById('batch-nums').innerHTML = `
      <span>${p.finished}/${p.total} 完成</span>
      <span style="color:var(--ok)">通過 ${p.pass}</span>
      <span style="color:var(--warn)">差異 ${p.diff}</span>
      <span style="color:var(--danger)">失敗 ${p.fail}</span>`
    for (const r of b.caseResults || []) {
      if (rows.has(r.caseId)) continue
      const row = el('div', { class: 'bpc-item' }, [
        el('span', { class: 'mono', style: 'font-weight:600', text: r.txnCode }),
        el('span', { class: 'spacer' }),
        statusEl(r.status),
      ])
      rows.set(r.caseId, row)
      listBox.append(row)
    }
    for (const r of b.caseResults || []) {
      const row = rows.get(r.caseId)
      if (row && r.status !== 'pending') {
        row.classList.add('done')
        const badge = row.querySelector('.bpc-badge')
        if (badge) {
          badge.textContent = statusText(r.status)
          badge.className = `badge bpc-badge ${statusCls(r.status)}`
        }
      }
    }
  }

  function finish(b) {
    const p = b.progress
    const summary = `批量回歸完成：${p.finished} 個案例 · 通過 ${p.pass} · 有差異 ${p.diff} · 失敗 ${p.fail}`
    toast(summary, p.fail > 0 ? 'err' : p.diff > 0 ? 'warn' : 'ok', 6000)
    head.querySelector('.modal-close').insertAdjacentHTML('beforebegin', `<span class="badge ${p.fail > 0 ? 'badge-danger' : p.diff > 0 ? 'badge-warn' : 'badge-ok'}" style="margin-right:6px">已完成</span>`)
    foot.append(el('button', { class: 'btn btn-primary', text: '查看案例列表', onclick: () => location.href = '/cases.html' }))
    // 完成後刷新當前頁數據
    window.dispatchEvent(new CustomEvent('batch:done', { detail: b }))
  }

  function statusEl(s) {
    return el('span', { class: `badge bpc-badge ${statusCls(s)}`, text: statusText(s) })
  }
  function statusText(s) {
    return { pending: '待執行', PASS: '通過', DIFF: '有差異', FAIL: '失敗', running: '執行中' }[s] || s
  }
  function statusCls(s) {
    return { pending: 'badge-neutral', PASS: 'badge-ok', DIFF: 'badge-warn', FAIL: 'badge-danger', running: 'badge-info' }[s] || 'badge-neutral'
  }
}

/** 頁面監聽批量完成事件後刷新（dashboard / cases 調用） */
export function onBatchDone(fn) {
  window.addEventListener('batch:done', (e) => fn(e.detail))
}
