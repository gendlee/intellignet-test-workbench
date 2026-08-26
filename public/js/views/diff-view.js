/**
 * Diff 結果渲染：判定橫幅、統計條、差異條目列表（可摺疊 + 語義高亮）
 * 所有使用者輸入經 esc() 轉義，高亮用 DOM class 而非 innerHTML 拼接原始值。
 */

import { el, esc, suspicionBadge, kindLabel, plausibilityLabel, stateTypeLabel, semanticDiff } from '../util.js'

/** 判決橫幅（執行後或回看歷史時展示） */
export function renderVerdictBanner(run, { extraMeta = false } = {}) {
  const v = run.verdict
  const map = {
    PASS: { label: '判定：通過（PASS）', cls: 'ok', desc: '兩側輸出字段級一致，無差異' },
    FAIL: { label: '判定：失敗（FAIL）', cls: 'danger', desc: '存在高可疑差異，需人工復核後方可上線' },
    DIFF: { label: '判定：有差異（DIFF）', cls: 'warn', desc: '存在低/中可疑差異（含格式性表示差異），建議人工確認是否可接受' },
  }
  const m = map[v] || { label: v || '—', cls: 'neutral', desc: '' }
  const banner = el('div', { class: `run-state-banner ${m.cls === 'danger' ? '' : m.cls}` }, [
    el('span', { class: 'rs-title', text: m.label }),
    el('span', { class: 'muted', style: 'flex:1', text: m.desc }),
  ])
  if (extraMeta && run.stateNote) {
    banner.append(el('span', { class: 'badge badge-info', text: `前置條件：${run.stateNote}` }))
  }
  if (v !== 'PASS') {
    banner.append(el('span', { class: 'badge badge-warn', text: '結論需人工確認，系統不自動判定合理性' }))
  }
  return banner
}

/** 統計條（total / added / deleted / modified / 可疑度分佈） */
export function renderDiffSummary(diff) {
  const s = diff.summary
  const wrap = el('div', { class: 'diff-summary' })
  const item = (label, value, cls = '') => {
    const box = el('div', { class: 'ds-item' }, [
      el('span', { class: 'ds-label', text: label }),
      el('span', { class: `ds-value ${cls}`, text: String(value) }),
    ])
    wrap.append(box)
  }
  item('差異總數', s.total)
  item('新增（新系統獨有）', s.added, 'added')
  item('刪除（主機獨有）', s.deleted, 'deleted')
  item('修改', s.modified, 'modified')
  item('高可疑', s.high)
  item('中可疑', s.medium)
  item('低可疑（格式性）', s.low)
  return wrap
}

/** 合理性評估條（stateful 提示 + 各類別計數） */
export function renderPlausibilityBar(diff) {
  const s = diff.summary
  const fmt = diff.items.filter((i) => i.plausibility === 'FORMAT').length
  const struct = diff.items.filter((i) => i.plausibility === 'STRUCTURAL').length
  const data = diff.items.filter((i) => i.plausibility === 'DATA').length
  const stateful = diff.stateType === 'STATEFUL'
  const bar = el('div', { class: `plausibility-bar${data > 0 || s.high > 0 ? ' alert' : ''}` }, [
    el('span', { class: 'pb-label', text: '合理性評估' }),
    el('span', { text: `格式性 ${fmt} · 結構性 ${struct} · 資料性 ${data}` }),
  ])
  if (stateful) {
    bar.append(el('span', { class: 'badge badge-info', text: '有狀態接口：資料性差異可能源於前置狀態，建議核對前置條件後重跑' }))
  } else {
    bar.append(el('span', { class: 'badge badge-neutral', text: '無狀態接口：同輸入應同輸出' }))
  }
  return bar
}

/** 差異條目列表（可摺疊，值對比 + 語義高亮 + 機器理由） */
export function renderDiffList(diff) {
  const wrap = el('div', { class: 'diff-list' })
  if (!diff.items.length) {
    wrap.append(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '✓' }),
      el('div', { text: '兩側輸出字段級一致，無差異' }),
    ]))
    return wrap
  }
  for (const item of diff.items) {
    const head = el('div', { class: 'di-head' }, [
      el('span', { class: 'di-kind', text: kindLabel[item.kind] || item.kind }),
      el('span', { class: 'di-path', text: item.path.join('.') }),
      el('span', { class: 'di-reason', text: item.reason }),
      el('span', { class: 'di-meta' }, [
        suspicionBadge(item.suspicion),
        item.precisionRisk ? el('span', { class: 'badge badge-warn', text: '精度風險' }) : null,
        el('span', { class: 'badge badge-neutral', text: plausibilityLabel[item.plausibility] || item.plausibility }),
        el('span', { class: 'di-toggle', text: '▶' }),
      ]),
    ])

    const detail = el('div', { class: 'di-detail' })
    const values = el('div', { class: 'diff-values' })
    const hostSide = el('div', { class: 'dv-side' }, [
      el('div', { class: 'dv-label' }, [el('span', { class: 'tag host', text: '主機（XML）' }), el('span', { class: 'muted', text: '期望值' })]),
      el('div', { class: `dv-value ${item.kind === 'added' ? 'dv-empty' : item.kind === 'deleted' ? 'host-v' : 'mod-v'}`, innerHTML: renderValue(item.hostValue) }),
    ])
    const newSide = el('div', { class: 'dv-side' }, [
      el('div', { class: 'dv-label' }, [el('span', { class: 'tag new', text: '新系統（JSON）' }), el('span', { class: 'muted', text: '實際值' })]),
      el('div', { class: `dv-value ${item.kind === 'deleted' ? 'dv-empty' : item.kind === 'added' ? 'new-v' : 'mod-v'}`, innerHTML: renderValue(item.newValue) }),
    ])
    values.append(hostSide, newSide)
    detail.append(values)

    const node = el('div', { class: `diff-item kind-${item.kind}` }, [head, detail])
    head.addEventListener('click', () => node.classList.toggle('open'))
    wrap.append(node)
  }
  return wrap
}

function renderValue(v) {
  if (v === null || v === undefined) return '<span class="muted">（無）</span>'
  return esc(v)
}

/** 雙欄原始報文（新增/刪除側以語義高亮呈現） */
export function renderDualRaw(run) {
  const pane = el('div', { class: 'dual-pane' })
  const hostBody = run.hostResult?.rawBody || run.inputSnapshot?.hostXml || ''
  const newBody = run.newResult?.rawBody || ''
  const makeSide = (title, cls, content) => {
    const side = el('div', {}, [
      el('div', { class: 'pane-head' }, [el('span', { class: `tag ${cls}`, text: title })]),
      el('div', { class: 'raw-body' }, [content]),
    ])
    return side
  }
  pane.append(
    makeSide('主機（XML）', 'host', el('pre', { text: hostBody || '（無報文）' })),
    makeSide('新系統（JSON）', 'new', el('pre', { text: newBody || '（無報文）' }))
  )
  return pane
}

/** 完整結果視圖：判定橫幅 + 統計 + 合理性 + 差異列表 + 雙欄報文 */
export function renderRunResult(run, { showRaw = true } = {}) {
  const box = el('div', { class: 'run-result' })
  box.append(renderVerdictBanner(run, { extraMeta: true }))
  if (run.diff?.summary) {
    box.append(renderDiffSummary(run.diff))
    box.append(renderPlausibilityBar(run.diff))
    box.append(renderDiffList(run.diff))
  }
  if (showRaw) {
    const title = el('div', { class: 'section-title', style: 'margin-top:22px' }, [
      el('span', { text: '原始報文對比' }),
      el('span', { class: 'count', text: '（差異處見上方條目）' }),
    ])
    box.append(title, renderDualRaw(run))
  }
  return box
}
