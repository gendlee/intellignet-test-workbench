/**
 * 版本號選擇器（執行前調用）
 * 版本號格式：YYYYMM + A（集中）/ B（非集中），如 202611A = 2026年11月集中版本。
 * 版本號在「案例中心 → 版本管理」維護，預生成三年（36 個月）供選擇。
 */

import { get } from '../api.js'
import { el } from '../util.js'
import { openModal } from '../components.js'

/** 彈出版本選擇；返回選中的版本 code（取消返回 null） */
export async function openVersionPicker({ title = '選擇執行版本' } = {}) {
  let versions = []
  try {
    const res = await get('/api/versions')
    versions = Array.isArray(res) ? res : []
  } catch (e) {
    return null
  }
  if (!versions.length) {
    openModal({
      title,
      body: el('div', { style: 'font-size:13.5px;line-height:1.7;color:var(--text)' }, [
        el('div', { text: '暫無可用版本號。' }),
        el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:6px', text: '請先到「案例中心 → 版本管理」維護版本號後再執行。' }),
      ]),
      foot: [el('button', { class: 'btn', text: '知道了', onclick: () => document.querySelector('.modal-mask:last-of-type')?.remove() })],
    })
    return null
  }
  const sorted = [...versions].sort((a, b) => b.code.localeCompare(a.code))
  const sel = el('select', { class: 'select', style: 'width:100%' },
    sorted.map((v) => el('option', { value: v.code, text: `${v.code} · ${v.modeLabel}（${v.month.slice(0, 4)}-${v.month.slice(4)}）` })))
  sel.value = sorted[0].code // 預設最新版本
  const body = el('div', {}, [
    el('label', { class: 'field', text: '本次執行版本' }),
    sel,
    el('div', { class: 'muted', style: 'font-size:12px;margin-top:8px', text: '版本號格式 YYYYMM + A/B：A=集中版本、B=非集中版本；在「案例中心 → 版本管理」維護，預生成三年每月各一。' }),
  ])
  return new Promise((resolve) => {
    const okBtn = el('button', { class: 'btn btn-primary', text: '開始執行', onclick: () => { close(); resolve(sel.value) } })
    const cancelBtn = el('button', { class: 'btn', text: '取消', onclick: () => { close(); resolve(null) } })
    const { close } = openModal({ title, body, foot: [cancelBtn, okBtn] })
  })
}
