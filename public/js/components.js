/** 共享 UI 組件：toast、modal、confirm、分頁渲染、表格輔助 */

import { el } from './util.js'

/* ---------- Toast ---------- */

export function toast(message, type = 'info', ms = 3200) {
  let root = document.getElementById('toast-root')
  if (!root) {
    root = el('div', { id: 'toast-root' })
    document.body.append(root)
  }
  const icon = type === 'ok' ? '✓' : type === 'err' ? '✕' : type === 'warn' ? '⚠' : 'ℹ'
  const node = el('div', { class: `toast ${type}` }, [
    el('span', { class: 't-icon', text: icon }),
    el('span', { text: message }),
  ])
  root.append(node)
  setTimeout(() => {
    node.classList.add('out')
    setTimeout(() => node.remove(), 280)
  }, ms)
}

/* ---------- Modal ---------- */

/**
 * @param {object} opts { title, body(HTMLElement|string), foot(HTMLElement[]), wide }
 * @returns {{ close: () => void, root: HTMLElement }}
 */
export function openModal({ title = '', body, foot = [], wide = false, onClose } = {}) {
  const mask = el('div', { class: 'modal-mask' })
  const modal = el('div', { class: `modal${wide ? ' wide' : ''}` })
  const head = el('div', { class: 'modal-head' }, [
    el('span', { text: title }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'modal-close', text: '✕', onclick: () => close() }),
  ])
  const bodyEl = el('div', { class: 'modal-body' })
  if (body instanceof Node) bodyEl.append(body)
  else bodyEl.innerHTML = body || ''
  modal.append(head, bodyEl)
  if (foot.length) {
    const footEl = el('div', { class: 'modal-foot' })
    for (const f of foot) footEl.append(f)
    modal.append(footEl)
  }
  mask.append(modal)
  const close = () => {
    mask.remove()
    if (onClose) onClose()
  }
  mask.addEventListener('click', (e) => { if (e.target === mask) close() })
  document.body.append(mask)
  return { close, root: modal }
}

export function confirmDialog({ title = '確認操作', message, danger = false, okText = '確認' }) {
  return new Promise((resolve) => {
    const okBtn = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: okText, onclick: () => { close(); resolve(true) } })
    const cancelBtn = el('button', { class: 'btn', text: '取消', onclick: () => { close(); resolve(false) } })
    const { close } = openModal({
      title,
      body: el('div', { style: 'font-size:13.5px;line-height:1.7;color:var(--text)' }, [message]),
      foot: [cancelBtn, okBtn],
    })
  })
}

/* ---------- 分頁 ---------- */

/** @param {object} p { page, pageSize, total, onChange } */
export function renderPagination(container, p) {
  container.innerHTML = ''
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize))
  const cur = Math.min(p.page, pages)
  const mk = (label, page, opts = {}) => {
    const b = el('button', { class: `btn btn-sm${page === cur ? ' active' : ''}${opts.disabled ? ' hidden' : ''}`, text: label, onclick: () => { if (page !== cur) p.onChange(page) } })
    if (opts.disabled) b.disabled = true
    return b
  }
  container.append(
    el('span', { text: `共 ${p.total} 筆 · 第 ${cur}/${pages} 頁` }),
    mk('‹', cur - 1, { disabled: cur <= 1 }),
    mk(String(cur), cur),
    mk('›', cur + 1, { disabled: cur >= pages }),
  )
}
