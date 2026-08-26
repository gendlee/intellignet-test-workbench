/**
 * 字段級編輯器：報文（JSON / XML）→ 行式表單 → 回序列化
 * - JSON：JSON.parse → 葉子行（path 段含陣列索引）→ 重建（全數字鍵物件轉陣列）→ JSON.stringify
 * - XML：shared xml-parser → 葉子行（屬性 @key / 混合文字 #text / 重複標籤 = 相同路徑多行）→ 重建 → 縮排序列化
 * 由 case-edit 的「原始報文 / 表單模式」切換調用。
 */

import { parseXML } from '/shared/diff/xml-parser.js'
import { el } from '/js/util.js'

/* ---------- 解析：text → rows ---------- */

export function parseRows(format, text) {
  try {
    return format === 'JSON' ? parseJson(String(text)) : parseXml(String(text))
  } catch (e) {
    return { error: e.message }
  }
}

/** infer=true 時對純文本做數字推斷（僅 XML 側，JSON 有 typeof 準確類型） */
function leafRow(path, key, value, infer = false) {
  let type = 'string'
  let raw = String(value)
  if (value === null || value === undefined) { type = 'null'; raw = '' }
  else if (typeof value === 'number') type = 'number'
  else if (typeof value === 'boolean') type = 'boolean'
  else if (infer && raw.trim() !== '' && !Number.isNaN(Number(raw.trim()))) type = 'number'
  return { path, key, type, raw }
}

function parseJson(text) {
  const value = JSON.parse(text)
  const rows = []
  const walk = (v, segs) => {
    if (v === null || typeof v !== 'object') {
      if (typeof v !== 'undefined') rows.push(leafRow(segs, segs[segs.length - 1], v))
      return
    }
    if (Array.isArray(v)) {
      v.forEach((it, i) => walk(it, [...segs, String(i)]))
      return
    }
    for (const [k, val] of Object.entries(v)) walk(val, [...segs, k])
  }
  walk(value, [])
  return { rows }
}

function parseXml(text) {
  const root = parseXML(text)
  const rows = []
  const walk = (el, segs, isRoot) => {
    for (const [k, v] of Object.entries(el.attrs || {})) {
      rows.push({ path: [...segs, `@${k}`], key: `@${k}`, type: 'string', raw: v })
    }
    const els = el.children.filter((c) => 'tag' in c)
    const text = el.children.filter((c) => 'text' in c).map((c) => c.text).join('')
    if (els.length === 0) {
      // 空元素也保留（序列化回 <Tag/>），保持往返一致
      rows.push(leafRow(segs, segs[segs.length - 1], text.trim(), true))
    } else {
      for (const c of els) walk(c, [...segs, c.tag])
      if (text.trim()) rows.push(leafRow([...segs, '#text'], '#text', text.trim()))
    }
  }
  walk(root, [root.tag], true)
  return { rows }
}

/* ---------- 序列化：rows → text ---------- */

export function serializeRows(format, rows) {
  return format === 'JSON' ? serializeJson(rows) : serializeXml(rows)
}

function convert(v, type) {
  if (type === 'null') return null
  if (type === 'number') return Number(v)
  if (type === 'boolean') return v === true || v === 'true'
  return String(v ?? '')
}

function serializeJson(rows) {
  const root = {}
  for (const r of rows) {
    const segs = r.path
    let cur = root
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i]
      if (cur[s] === undefined) cur[s] = {}
      cur = cur[s]
    }
    cur[segs[segs.length - 1]] = convert(r.raw, r.type)
  }
  const arrify = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(arrify)
    const keys = Object.keys(v)
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const arr = []
      keys.sort((a, b) => Number(a) - Number(b))
      for (const k of keys) arr.push(arrify(v[k]))
      return arr
    }
    const out = {}
    for (const k of keys) out[k] = arrify(v[k])
    return out
  }
  return JSON.stringify(arrify(root), null, 2)
}

function serializeXml(rows) {
  if (!rows.length) return ''
  const root = { tag: rows[0].path[0], attrs: {}, children: [] }
  for (const r of rows) {
    let cur = root
    for (let i = 1; i < r.path.length - 1; i++) {
      const s = r.path[i]
      // 只匹配容器節點（children 為陣列），避免誤入葉子
      let next = cur.children.find((c) => c.tag === s && c.children)
      if (!next) {
        next = { tag: s, attrs: {}, children: [] }
        cur.children.push(next)
      }
      cur = next
    }
    const last = r.path[r.path.length - 1]
    if (last.startsWith('@')) {
      cur.attrs[last.slice(1)] = r.raw
    } else if (last === '#text') {
      cur.children.push({ text: String(r.raw ?? '') })
    } else {
      // 葉子節點：children 用 null 標記，與容器（陣列）區分
      cur.children.push({ tag: last, attrs: {}, children: null, text: String(r.raw ?? '') })
    }
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;')
  const indent = (d) => '  '.repeat(d)
  const render = (el, d) => {
    const attrStr = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')
    if (el.children == null) {
      const t = el.text ?? ''
      return t === ''
        ? `${indent(d)}<${el.tag}${attrStr}/>`
        : `${indent(d)}<${el.tag}${attrStr}>${esc(t)}</${el.tag}>`
    }
    const inner = el.children.map((c) => ('tag' in c ? render(c, d + 1) : `${indent(d + 1)}${esc(c.text)}`)).join('\n')
    return `${indent(d)}<${el.tag}${attrStr}>\n${inner}\n${indent(d)}</${el.tag}>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0)}`
}

/* ---------- 行式表單渲染 ---------- */

/**
 * 渲染字段表單（行：路徑 + 值 + 類型 + 刪除；底部新增行）
 * @param {object} opts { rows, onEdit(i, patch), onDelete(i), onAdd(path, type, value) }
 * @returns {HTMLElement}
 */
const TYPES = [['string', '字符串'], ['number', '數字'], ['boolean', '布爾'], ['null', '空值']]

export function renderFieldForm(opts) {
  const { rows, onEdit, onDelete, onAdd } = opts
  const box = el('div', { class: 'fe-form' })
  const list = el('div', { class: 'fe-list' })
  // 僅在增/刪時重渲染；編輯原地改行，避免輸入失焦
  const rerender = () => {
    list.innerHTML = ''
    list.append(...rows.map((r, i) => rowEl(r, i)))
  }
  const typeSel = (v = 'string', onchange = null) =>
    el('select', { class: 'select', style: 'width:86px', onchange }, [
      ...TYPES.map(([t, l]) => el('option', { value: t, text: l, selected: t === v })),
      el('option', { value: '', text: '', selected: false, style: 'display:none' }),
    ])
  const rowEl = (r, i) => {
    const depth = r.path.length - 1
    return el('div', { class: 'fe-row' }, [
      el('span', { class: 'fe-indent', style: `width:${depth * 14}px` }),
      el('span', { class: 'fe-path mono', title: r.path.join('.'), text: r.key }),
      el('input', {
        class: 'input', style: 'flex:1;font-family:var(--mono);font-size:12px',
        value: r.raw, placeholder: '值',
        oninput: (e) => onEdit(i, { raw: e.target.value }),
      }),
      typeSel(r.type, (e) => onEdit(i, { type: e.target.value })),
      el('button', { class: 'btn btn-sm btn-ghost', text: '✕', title: '刪除字段', onclick: () => onDelete(i) }),
    ])
  }
  const addRow = el('div', { class: 'fe-add' }, [
    el('span', { class: 'muted', style: 'font-size:11.5px', text: '＋ 新增字段' }),
    el('input', { class: 'input mono fe-add-path', style: 'flex:1', placeholder: '路徑（點分，如 Body.RiskLevel）' }),
    el('input', { class: 'input fe-add-val', style: 'flex:1', placeholder: '值' }),
    typeSel(),
    el('button', { class: 'btn btn-sm btn-primary', text: '增加', onclick: () => {
      const [pEl, vEl] = addRow.querySelectorAll('input')
      const p = pEl.value.trim()
      if (!p) return
      onAdd(p, addRow.querySelector('.fe-add .select, select').value, vEl.value)
      pEl.value = ''
      vEl.value = ''
    } }),
  ])
  box.append(list, addRow)
  rerender()
  return box
}
