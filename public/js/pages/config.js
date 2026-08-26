/**
 * 系統配置頁：
 * 1) URL 模板（固定段只讀 + 變數段可編輯/增刪）——AI 生成新案例時依此拼接地址
 * 2) 默認請求頭（啟用/密鑰標記/增刪）
 * 3) Diff 比對規則（陣列對齊/忽略欄位/動態正則/數值與時間精度…）
 * 4) 權限與系統（需求9 預留位：EBP-CL 可編輯、其餘系統只讀、功能開關展示）
 */

import { initLayout, loadMeta } from '../layout.js'
import { get, put } from '../api.js'
import { el, maskSecret } from '../util.js'
import { toast } from '../components.js'

let rootEl
let config = null
let meta = null

async function load() {
  config = await get('/api/config')
  meta = await loadMeta(true)
  render()
}

function render() {
  rootEl.innerHTML = ''
  const readOnly = !!config.readOnly
  if (readOnly) {
    rootEl.append(el('div', { class: 'batch-banner', style: 'margin-top:0' }, [
      el('div', {}, [
        el('div', { class: 'bb-title', text: '目前系統為只讀環境（EBP-CL 僅展示）' }),
        el('div', { class: 'bb-sub', text: '配置變更需在可寫入系統環境下操作。' }),
      ]),
    ]))
  }
  rootEl.append(
    el('div', { class: 'flex', style: 'margin-bottom:14px' }, [
      el('div', { class: 'section-title', style: 'margin:0', text: '系統配置' }),
      el('span', { class: 'count', text: `${config.systemId} · ${readOnly ? '只讀' : '可編輯'}` }),
    ]),
    renderEnvironments(),
    renderUrlTemplate(),
    renderDefaultHeaders(),
    renderDiffRules(),
    renderPermission(),
  )
}

/* ---------- 0. 環境變量（需求 9） ---------- */

function renderEnvironments() {
  const envs = config.environments || []
  const rows = el('div', {})
  const renderRows = () => {
    rows.replaceChildren(...envs.map((e, i) => el('div', { class: 'env-row' }, [
      el('input', {
        class: 'input mono', style: 'width:90px', value: e.id,
        placeholder: 'ID', disabled: e.current || config.readOnly,
        oninput: (ev) => { e.id = ev.target.value.trim() },
      }),
      el('input', {
        class: 'input', style: 'width:190px', value: e.name,
        placeholder: '環境名稱', disabled: config.readOnly,
        oninput: (ev) => { e.name = ev.target.value.trim() },
      }),
      el('input', {
        class: 'input mono', style: 'flex:1', value: e.baseUrl,
        placeholder: 'https://…', disabled: config.readOnly,
        oninput: (ev) => { e.baseUrl = ev.target.value.trim() },
      }),
      el('label', { class: 'flex', style: 'gap:6px;align-items:center;font-size:12px;cursor:pointer;white-space:nowrap' }, [
        el('input', {
          type: 'radio', name: 'env-cur', checked: !!e.current, disabled: config.readOnly,
          onchange: () => { envs.forEach((x) => (x.current = false)); e.current = true; renderRows() },
        }),
        el('span', { text: '設為當前' }),
      ]),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '✕', title: '刪除環境',
        disabled: envs.length <= 1 || config.readOnly,
        onclick: () => { envs.splice(i, 1); renderRows() },
      }),
    ])))
  }
  renderRows()
  return el('div', { class: 'card', style: 'padding:18px' }, [
    el('div', { class: 'section-title' }, [el('span', { text: '環境變量' }),
      el('span', { class: 'count', text: 'SIT1 / SIT3 / USMK / USMF — 全域當前環境（AI 生成與案例執行使用）' })]),
    rows,
    el('div', { class: 'flex', style: 'margin-top:12px' }, [
      el('button', {
        class: 'btn btn-sm', text: '＋ 新增環境', disabled: config.readOnly,
        onclick: () => { envs.push({ id: '', name: '', baseUrl: '', current: envs.length === 0 }); renderRows() },
      }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary btn-sm', text: '保存環境', onclick: saveEnvs }),
    ]),
  ])
  async function saveEnvs() {
    try {
      await put('/api/config', { environments: envs })
      toast('環境變量已保存', 'ok')
      await load()
    } catch (e) { toast(e.message, 'err') }
  }
}

/* ---------- 1. URL 模板 ---------- */

function renderUrlTemplate() {
  const addVar = el('button', {
    class: 'btn btn-sm', text: '＋ 新增變數段',
    disabled: config.readOnly,
    onclick: () => {
      config.urlTemplate.push({ kind: 'var', value: '' })
      renderUrlTemplateCard()
    },
  })

  function renderUrlTemplateCard() {
    urlCard.replaceChildren(
      el('div', { class: 'section-title' }, [el('span', { text: 'URL 模板' }),
        el('span', { class: 'count', text: 'AI 生成案例時依此拼接微服務系統地址' })]),
      el('div', { class: 'url-segments' }, segRowInner()),
      el('div', { class: 'flex', style: 'margin-top:12px' }, [addVar, el('span', { class: 'spacer' }), saveUrlBtn]),
    )
  }

  function segRowInner() {
    const out = []
    config.urlTemplate.forEach((s, i) => {
      if (i > 0) out.push(el('span', { class: 'sep', text: '/' }))
      out.push(s.kind === 'fixed'
        ? el('span', { class: 'seg fixed', text: s.value })
        : el('span', { class: 'seg var' }, [
            el('input', {
              class: 'input',
              style: 'width:110px;padding:3px 8px;font-size:12px',
              value: s.value,
              placeholder: '變數段',
              disabled: config.readOnly,
              oninput: (e) => { s.value = e.target.value.trim() },
            }),
            el('button', {
              class: 'seg-del', title: '移除該段', text: '✕',
              disabled: config.readOnly,
              onclick: () => { config.urlTemplate.splice(i, 1); renderUrlTemplateCard() },
            }),
          ]))
    })
    return out
  }

  const saveUrlBtn = el('button', { class: 'btn btn-primary btn-sm', text: '保存 URL 模板', onclick: saveUrl })
  async function saveUrl() {
    try {
      await put('/api/config', { urlTemplate: config.urlTemplate })
      toast('URL 模板已保存', 'ok')
      await load()
    } catch (e) { toast(e.message, 'err') }
  }

  const urlCard = el('div', { class: 'card', style: 'padding:18px' })
  renderUrlTemplateCard()
  return urlCard
}

/* ---------- 2. 默認請求頭 ---------- */

function renderDefaultHeaders() {
  const headers = config.defaultHeaders
  const rows = el('div', {}, headers.map((h, i) => headerRow(h, i)))

  function headerRow(h, i) {
    const secret = !!h.secret
    let reveal = false
    const valInput = el('input', {
      class: 'input mono', style: 'flex:1;min-width:0', placeholder: '值',
      value: secret ? maskSecret(h.value) : h.value,
      disabled: config.readOnly, readOnly: secret,
      title: secret ? '密鑰欄位，已脫敏顯示' : '',
      oninput: (e) => { h.value = e.target.value },
    })
    const eye = el('button', {
      class: 'btn btn-sm btn-ghost', text: '👁', title: '顯示 / 隱藏密鑰',
      style: secret ? '' : 'visibility:hidden',
      onclick: () => {
        reveal = !reveal
        valInput.value = reveal ? h.value : maskSecret(h.value)
        valInput.readOnly = !reveal || config.readOnly
      },
    })
    return el('div', { class: 'header-row' }, [
      el('input', {
        class: 'input', placeholder: 'Header 名稱', value: h.name,
        disabled: config.readOnly,
        oninput: (e) => { h.name = e.target.value.trim() },
      }),
      el('div', { class: 'flex', style: 'gap:4px;min-width:0' }, [
        el('div', { style: 'flex:1;min-width:0;display:flex' }, [valInput]),
        eye,
      ]),
      el('label', { class: 'switch', title: '啟用' }, [
        el('input', { type: 'checkbox', checked: h.enabled, disabled: config.readOnly, onchange: (e) => { h.enabled = e.target.checked } }),
        el('span', { class: 'slider' }),
      ]),
      el('div', { class: 'flex', style: 'gap:6px' }, [
        el('label', { class: 'switch', title: h.secret ? '密鑰（打碼顯示）' : '普通欄位' }, [
          el('input', { type: 'checkbox', checked: h.secret, disabled: config.readOnly, onchange: (e) => { h.secret = e.target.checked; rerender() } }),
          el('span', { class: 'slider' }),
        ]),
        el('button', {
          class: 'btn btn-sm btn-danger', text: '刪除',
          disabled: config.readOnly,
          onclick: () => { config.defaultHeaders.splice(i, 1); rerender() },
        }),
      ]),
    ])
  }

  function rerender() {
    rows.replaceChildren(...config.defaultHeaders.map((h, i) => headerRow(h, i)))
  }

  return el('div', { class: 'card', style: 'padding:18px' }, [
    el('div', { class: 'section-title' }, [el('span', { text: '默認請求頭' }),
      el('span', { class: 'count', text: '發送至微服務系統的固定頭部（API-Key 等）' })]),
    rows,
    el('div', { class: 'flex', style: 'margin-top:12px' }, [
      el('button', { class: 'btn btn-sm', text: '＋ 新增請求頭', disabled: config.readOnly, onclick: () => { config.defaultHeaders.push({ name: '', value: '', enabled: true, secret: false }); rerender() } }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary btn-sm', text: '保存請求頭', onclick: saveHeaders }),
    ]),
  ])

  async function saveHeaders() {
    try {
      await put('/api/config', { defaultHeaders: config.defaultHeaders })
      toast('默認請求頭已保存', 'ok')
      await load()
    } catch (e) { toast(e.message, 'err') }
  }
}

/* ---------- 3. Diff 規則 ---------- */

function renderDiffRules() {
  const r = config.diffRules
  const field = (label, control, hint = '') => el('div', { class: 'field-row' }, [
    el('label', { class: 'field', text: label }),
    control,
    hint ? el('div', { class: 'muted', style: 'font-size:11.5px;grid-column:2', text: hint }) : null,
  ])
  const toggles = (label, key, hint = '') => el('div', { class: 'field-row' }, [
    el('label', { class: 'field', text: label }),
    el('div', { class: 'flex', style: 'gap:10px;align-items:center' }, [
      el('label', { class: 'switch' }, [
        el('input', { type: 'checkbox', checked: !!r[key], disabled: config.readOnly, onchange: (e) => { r[key] = e.target.checked } }),
        el('span', { class: 'slider' }),
      ]),
      hint ? el('span', { class: 'muted', style: 'font-size:11.5px', text: hint }) : null,
    ]),
  ])
  const comma = (key, placeholder, hint) => field(key, el('input', {
    class: 'input mono',
    value: (r[key] || []).join(', '),
    placeholder,
    disabled: config.readOnly,
    oninput: (e) => {
      r[key] = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    },
  }), hint)

  const rulesCard = el('div', { class: 'card', style: 'padding:18px' }, [
    el('div', { class: 'section-title' }, [el('span', { text: 'Diff 比對規則' }),
      el('span', { class: 'count', text: '兩系統輸出欄位級比對的統一規則（執行與展示同一套引擎）' })]),
    el('div', { class: 'form-grid', style: 'margin-top:6px' }, [
      field('陣列對齊模式', el('select', { class: 'select', disabled: config.readOnly, onchange: (e) => { r.arrayMatchMode = e.target.value; rerenderRules() } },
        [['index', '按索引'], ['key', '按主鍵']].map(([v, label]) => el('option', { value: v, text: label, selected: r.arrayMatchMode === v })))),
      field('陣列主鍵欄位', el('input', {
        class: 'input mono',
        value: Object.keys(r.arrayMatchKeys || {}).join(', '),
        placeholder: 'txnId, seqNo',
        disabled: config.readOnly,
        oninput: (e) => { r.arrayMatchKeys = Object.fromEntries(e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((k) => [k, k])) },
      }), 'key 模式下依此對齊陣列元素'),
      comma('ignoreFields', 'RespMsg, extInfo', '忽略的欄位（不參與比對）'),
      comma('dynamicRegex', '.*(tStamp|nonce|traceId|requestId)$', '動態欄位正則（每次執行值不同）'),
      comma('wrapIgnoreKeys', '', '包裝層鍵名（收斂後不參與比對）'),
      field('數值精度', el('select', { class: 'select', disabled: config.readOnly, onchange: (e) => { r.numeric = e.target.value } },
        [['strict', '嚴格（按字符串比對）'], ['loose', '寬鬆（數字化比對）']].map(([v, label]) => el('option', { value: v, text: label, selected: r.numeric === v }))), 'strict 防浮點/精度差異誤判'),
      field('長數字告警位數', el('input', {
        class: 'input', type: 'number', min: 1, max: 30,
        value: r.longNumberGuard,
        disabled: config.readOnly,
        oninput: (e) => { r.longNumberGuard = Number(e.target.value) || 15 },
      }), '超過該位數視為長數字（精度風險標記）'),
      toggles('時間格式歸一', 'timeNormalize', 'ISO/yyyy-MM-dd HH:mm:ss/epoch 統一比較'),
      toggles('XML 屬性合併', 'attrMerge', '屬性與子欄位同層比對'),
      toggles('命名空間不敏感', 'namespaceInsensitive', 'prefix:local 忽略前綴'),
      toggles('空串等於空值', 'emptyEqualsNull', '空字串與缺失視為相等'),
      toggles('單元素陣列收斂', 'collapseSingleArray', '長度 1 的陣列收斂為標量比較'),
    ]),
    el('div', { class: 'flex', style: 'margin-top:14px' }, [
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary btn-sm', text: '保存規則', onclick: saveRules }),
    ]),
  ])

  function rerenderRules() {
    // 僅更新主鍵欄位的可用性提示（簡化：重建整卡）
    rootEl.innerHTML = ''
    render()
  }

  async function saveRules() {
    try {
      await put('/api/config', { diffRules: config.diffRules })
      toast('Diff 規則已保存', 'ok')
      await load()
    } catch (e) { toast(e.message, 'err') }
  }

  return rulesCard
}

/* ---------- 4. 權限與系統（需求9 展示位） ---------- */

function renderPermission() {
  const features = meta.features || {}
  const feat = (name, on, note = '') => el('div', { class: 'flex', style: 'gap:8px;align-items:center;padding:6px 0' }, [
    el('span', { class: on ? 'badge badge-ok' : 'badge badge-neutral', text: on ? '可用' : '未啟用' }),
    el('span', { style: 'font-weight:600;font-size:13px', text: name }),
    el('span', { class: 'muted', style: 'font-size:12px', text: note }),
  ])

  return el('div', { class: 'card', style: 'padding:18px' }, [
    el('div', { class: 'section-title' }, [el('span', { text: '權限與系統' }),
      el('span', { class: 'count', text: 'EBP-CL 接入權限與功能開關（當前環境示範）' })]),
    el('div', { class: 'form-grid', style: 'margin-top:6px' }, [
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field', text: '當前用戶' }),
        el('div', {}, [
          el('div', { style: 'font-weight:600', text: `${meta.currentUser?.name || '—'}（${meta.currentUser?.role || '—'}）` }),
          el('div', { class: 'muted', style: 'font-size:11.5px', text: `操作員 ${meta.currentUser?.id || ''}` }),
        ]),
      ]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field', text: '系統接入' }),
        el('div', { class: 'flex', style: 'flex-direction:column;gap:6px' }, (meta.systems || []).map((s) =>
          el('div', { class: 'flex', style: 'gap:8px;align-items:center' }, [
            el('span', { class: 'badge', style: s.active ? 'background:var(--brand);color:#fff' : '', text: s.id }),
            el('span', { style: 'font-size:12.5px', text: s.name }),
            el('span', { class: 'badge ' + (s.readOnly ? 'badge-neutral' : 'badge-ok'), text: s.readOnly ? '只讀' : '可讀寫' }),
            s.active ? el('span', { class: 'badge badge-info', text: '當前' }) : null,
          ]))),
      ]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field', text: '功能開關' }),
        el('div', { class: 'flex', style: 'flex-direction:column;gap:2px' }, [
          feat('AI 生成案例', !!features.aiGenerate, '主控 XML → 微服務系統 JSON'),
          feat('壓力測試', !!features.stress, '並發/時長/曲線'),
          feat('流量接入（Capture）', !!features.capture, '需求3 預留：自動捕獲生產流量轉為測試案例'),
          feat('多系統切換', !!features.multiSystem, '預留：橫向多系統對比'),
        ]),
      ]),
    ]),
  ])
}

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  try {
    await load()
  } catch (e) {
    rootEl.innerHTML = `<div class="empty">載入失敗：${e.message}</div>`
  }
}

init()
