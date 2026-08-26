/**
 * 業務模塊維護頁：模塊 CRUD（名稱/代碼/描述）、案例數統計、刪除保護
 */

import { initLayout } from '../layout.js'
import { get, post, put, del } from '../api.js'
import { esc, el } from '../util.js'
import { confirmDialog, openModal, toast } from '../components.js'

let rootEl
const state = { modules: [] }

async function load() {
  state.modules = await get('/api/modules')
  render()
}

function render() {
  rootEl.innerHTML = ''
  rootEl.append(
    el('div', { class: 'flex', style: 'margin-bottom:14px' }, [
      el('div', { class: 'section-title', style: 'margin:0', text: '業務模塊' }),
      el('span', { class: 'count', text: `${state.modules.length} 個模塊` }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', text: '＋ 新建模塊', onclick: () => openModuleModal() }),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'tbl' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: '代碼' }), el('th', { text: '模塊名稱' }), el('th', { text: '描述' }),
            el('th', { class: 'num', text: '案例數' }), el('th', { text: '操作', style: 'text-align:right' }),
          ])]),
          el('tbody', {}, state.modules.length ? state.modules.map((m) => el('tr', {}, [
            el('td', {}, [el('span', { class: 'badge badge-info', text: m.code })]),
            el('td', {}, [el('b', { text: m.name })]),
            el('td', {}, [el('span', { class: 'muted', text: m.description || '—' })]),
            el('td', { class: 'num' }, [
              el('a', { class: 'mod-count', href: `/cases.html?module=${encodeURIComponent(m.name)}`, text: `${m.caseCount} 個案例` }),
            ]),
            el('td', { style: 'text-align:right;white-space:nowrap' }, [
              el('button', { class: 'btn btn-sm', text: '編輯', onclick: () => openModuleModal(m) }),
              el('button', { class: 'btn btn-sm btn-danger', text: '刪除', onclick: () => deleteModule(m), disabled: m.caseCount > 0 }),
            ]),
          ])) : [el('tr', {}, [el('td', { colspan: 5, class: 'empty', text: '暫無模塊，點擊右上角新建' })])]),
        ]),
      ]),
    ]),
  )
}

function openModuleModal(m = null) {
  const f = (v) => (m ? v ?? '' : '')
  const form = el('div', { class: 'form-grid' }, [
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field', text: '模塊代碼（唯一）' }),
      el('input', { class: 'input mono', id: 'm-code', value: f(m?.code), placeholder: '例：ACCT', disabled: !!m }),
    ]),
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field', text: '模塊名稱' }),
      el('input', { class: 'input', id: 'm-name', value: f(m?.name), placeholder: '例：帳戶查詢' }),
    ]),
    el('div', { class: 'field-row full' }, [
      el('label', { class: 'field', text: '描述' }),
      el('input', { class: 'input', id: 'm-desc', value: f(m?.description), placeholder: '模塊用途說明' }),
    ]),
  ])
  const okBtn = el('button', { class: 'btn btn-primary', text: m ? '保存' : '建立', onclick: save })
  const cancelBtn = el('button', { class: 'btn', text: '取消', onclick: () => close() })
  const { close } = openModal({
    title: m ? '編輯模塊' : '新建模塊',
    body: form,
    foot: [cancelBtn, okBtn],
  })
  async function save() {
    const payload = {
      code: form.querySelector('#m-code').value.trim(),
      name: form.querySelector('#m-name').value.trim(),
      description: form.querySelector('#m-desc').value.trim(),
    }
    if (!payload.code || !payload.name) return toast('代碼與名稱必填', 'warn')
    try {
      if (m) await put(`/api/modules/${m.id}`, payload)
      else await post('/api/modules', payload)
      toast(m ? '已保存' : '已建立', 'ok')
      close()
      await load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }
}

async function deleteModule(m) {
  const ok = await confirmDialog({ title: '刪除模塊', message: `確定刪除模塊「${m.name}（${m.code}）」？`, danger: true, okText: '刪除' })
  if (!ok) return
  try {
    await del(`/api/modules/${m.id}`)
    toast('已刪除', 'ok')
    await load()
  } catch (e) {
    toast(e.message, 'err')
  }
}

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  try {
    await load()
  } catch (e) {
    rootEl.innerHTML = `<div class="empty">載入失敗：${esc(e.message)}</div>`
  }
}

init()
