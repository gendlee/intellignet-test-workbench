/**
 * 版本管理（案例中心）
 * 版本號格式：YYYYMM + A/Z，202611A = 2026年11月集中版本、202611Z = 2026年11月非集中版本。
 * 預生成三年（36 個月）每月集中/非集中各一；執行案例時選擇本次版本。
 */

import { initLayout } from '../layout.js'
import { get, post, del } from '../api.js'
import { el, esc, fmtTime } from '../util.js'
import { toast, confirmDialog, openModal } from '../components.js'

let rootEl

async function load() {
  rootEl.innerHTML = ''
  const versions = await get('/api/versions')
  rootEl.append(
    el('div', { class: 'flex', style: 'margin-bottom:14px' }, [
      el('div', { class: 'section-title', style: 'margin:0', text: '版本管理' }),
      el('span', { class: 'count', text: `${versions.length} 個版本 · 預生成三年（36 個月），每月集中 A / 非集中 Z` }),
    ]),
    renderTable(versions),
  )
}

function renderTable(versions) {
  const tbody = el('tbody')
  const reRender = () => {
    tbody.replaceChildren(...versions.map((v) => el('tr', {}, [
      el('td', {}, [el('span', { class: 'mono', style: 'font-weight:700;font-size:13px;color:var(--brand)', text: v.code })]),
      el('td', { class: 'mono', text: `${v.month.slice(0, 4)}-${v.month.slice(4)}` }),
      el('td', {}, [el('span', { class: 'badge ' + (v.mode === 'A' ? 'badge-ok' : 'badge-neutral'), text: v.mode === 'A' ? '集中版本' : '非集中版本' })]),
      // 執行記錄：可跳轉案例管理回溯該版本執行過的案例
      el('td', {}, [
        v.executedCaseCount
          ? el('a', {
              class: 'exec-link',
              href: `/cases.html?version=${v.code}`,
              title: `該版本下執行過的案例（${v.executedCaseCount} 個案例 · ${v.runCount} 次執行）`,
              text: `${v.executedCaseCount} 案例 · ${v.runCount} 次執行 →`,
            })
          : el('span', { class: 'muted', text: '暫無執行' }),
      ]),
      el('td', { class: 'muted', style: 'white-space:nowrap', text: fmtTime(v.createdAt) }),
      el('td', {}, [el('button', {
        class: 'btn btn-sm btn-danger', text: '刪除',
        onclick: async () => {
          const ok = await confirmDialog({ title: '刪除版本', message: `確定刪除版本號 ${v.code}？`, danger: true, okText: '刪除' })
          if (!ok) return
          try {
            await del(`/api/versions/${v.id}`)
            toast(`版本 ${v.code} 已刪除`, 'ok')
            await load()
          } catch (e) { toast(e.message, 'err') }
        },
      })]),
    ])))
  }
  reRender()
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '版本號列表' }),
      el('span', { class: 'sub', text: '執行案例（單條/批量）時選擇本次版本；202611A=集中版本、202611Z=非集中版本（2026年11月）' }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-sm btn-primary', text: '＋ 新增版本', onclick: () => openAdd(versions, reRender) }),
    ]),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'tbl' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: '版本號' }), el('th', { text: '月份' }), el('th', { text: '類型' }),
          el('th', { text: '執行記錄' }), el('th', { text: '創建時間' }), el('th', { text: '操作' }),
        ])]),
        tbody,
      ]),
    ]),
  ])
}

function openAdd(versions, reRender) {
  const now = new Date()
  const months = []
  // 補錄歷史/未來：當前月前 24 個月 + 後 24 個月
  for (let i = -24; i <= 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthSel = el('select', { class: 'select', style: 'width:100%' },
    months.map((m) => el('option', { value: m, text: m, selected: m === months[24] })))
  const modeSel = el('select', { class: 'select', style: 'width:100%' }, [
    el('option', { value: 'A', text: '集中版本（後綴 A）' }),
    el('option', { value: 'Z', text: '非集中版本（後綴 Z）' }),
  ])
  const preview = el('code', { style: 'font-size:13px', text: `${months[24].replace('-', '')}A` })
  const refreshPreview = () => { preview.textContent = `${monthSel.value.replace('-', '')}${modeSel.value}` }
  monthSel.onchange = refreshPreview
  modeSel.onchange = refreshPreview

  const okBtn = el('button', {
    class: 'btn btn-primary', text: '新增',
    onclick: async () => {
      try {
        const v = await post('/api/versions', { month: monthSel.value, mode: modeSel.value })
        toast(`版本號 ${v.code} 已新增`, 'ok')
        close()
        await load()
      } catch (e) { toast(e.message, 'err') }
    },
  })
  const cancelBtn = el('button', { class: 'btn', text: '取消', onclick: () => close() })
  const { close } = openModal({
    title: '新增版本號',
    body: el('div', {}, [
      el('label', { class: 'field', text: '月份' }),
      monthSel,
      el('label', { class: 'field', text: '類型', style: 'margin-top:12px' }),
      modeSel,
      el('div', { style: 'margin-top:12px;font-size:13px;color:var(--text-2)' }, [
        el('span', { text: '將生成版本號：' }), preview,
      ]),
    ]),
    foot: [cancelBtn, okBtn],
  })
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
