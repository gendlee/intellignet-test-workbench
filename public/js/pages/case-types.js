/**
 * 案例類型維護頁：類型 CRUD（名稱/描述）、案例數統計、刪除保護
 * 案例錄入頁的「案例類型」下拉引用此處列表，可擴展維護。
 */

import { initLayout } from '../layout.js'
import { get, post, put, del } from '../api.js'
import { esc, el } from '../util.js'
import { confirmDialog, openModal, toast } from '../components.js'

let rootEl
const state = { caseTypes: [] }

async function load() {
  state.caseTypes = await get('/api/case-types')
  render()
}

function render() {
  rootEl.innerHTML = ''
  rootEl.append(
    el('div', { class: 'flex', style: 'margin-bottom:14px' }, [
      el('div', { class: 'section-title', style: 'margin:0', text: '案例類型' }),
      el('span', { class: 'count', text: `${state.caseTypes.length} 個類型` }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', text: '＋ 新建類型', onclick: () => openTypeModal() }),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: '類型列表' }),
        el('span', { class: 'sub', text: '案例錄入時選擇案例類型；可在此新增/編輯，被案例引用時不可刪除' }),
      ]),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'tbl' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: '類型名稱' }), el('th', { text: '描述' }),
            el('th', { class: 'num', text: '案例數' }), el('th', { text: '操作', style: 'text-align:right' }),
          ])]),
          el('tbody', {}, state.caseTypes.length ? state.caseTypes.map((t) => el('tr', {}, [
            el('td', {}, [el('span', { class: 'badge badge-neutral mono', text: t.name })]),
            el('td', {}, [el('span', { class: 'muted', text: t.description || '—' })]),
            el('td', { class: 'num' }, [el('span', { class: 'muted', text: `${t.caseCount} 個案例` })]),
            el('td', { style: 'text-align:right;white-space:nowrap' }, [
              el('button', { class: 'btn btn-sm', text: '編輯', onclick: () => openTypeModal(t) }),
              el('button', { class: 'btn btn-sm btn-danger', text: '刪除', onclick: () => deleteType(t), disabled: t.caseCount > 0 }),
            ]),
          ])) : [el('tr', {}, [el('td', { colspan: 4, class: 'empty', text: '暫無類型，點擊右上角新建' })])]),
        ]),
      ]),
    ]),
  )
}

function openTypeModal(t = null) {
  const form = el('div', {}, [
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field', text: '類型名稱（唯一，案例.type 引用）' }),
      el('input', { class: 'input mono', id: 'ct-name', value: t?.name || '', placeholder: '例：Regression' }),
    ]),
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field', text: '描述' }),
      el('input', { class: 'input', id: 'ct-desc', value: t?.description || '', placeholder: '該類型適用的場景說明' }),
    ]),
  ])
  const okBtn = el('button', { class: 'btn btn-primary', text: t ? '保存' : '建立', onclick: save })
  const cancelBtn = el('button', { class: 'btn', text: '取消', onclick: () => close() })
  const { close } = openModal({
    title: t ? '編輯案例類型' : '新建案例類型',
    body: form,
    foot: [cancelBtn, okBtn],
  })
  async function save() {
    const payload = {
      name: form.querySelector('#ct-name').value.trim(),
      description: form.querySelector('#ct-desc').value.trim(),
    }
    if (!payload.name) return toast('類型名稱必填', 'warn')
    try {
      if (t) await put(`/api/case-types/${t.id}`, payload)
      else await post('/api/case-types', payload)
      toast(t ? '已保存' : '已建立', 'ok')
      close()
      await load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }
}

async function deleteType(t) {
  const ok = await confirmDialog({ title: '刪除案例類型', message: `確定刪除案例類型「${t.name}」？`, danger: true, okText: '刪除' })
  if (!ok) return
  try {
    await del(`/api/case-types/${t.id}`)
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
