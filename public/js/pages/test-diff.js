/**
 * Diff 引擎自測面板：瀏覽器內直接調用 shared/diff（與執行結果同一演算法）
 * 用途：快速驗證引擎在瀏覽器環境可用，並方便調試規則。
 */

import { initLayout } from '../layout.js'
import { compare } from '../../../shared/diff/diff.js'
import { get } from '../api.js'
import { el } from '../util.js'
import { renderRunResult } from '../views/diff-view.js'

const SAMPLES = {
  '時間格式差異': {
    stateType: 'STATELESS',
    host: `<?xml version="1.0" encoding="UTF-8"?>
<AccountInquiryResponse>
  <Header>
    <TxnCode>ACCT1002</TxnCode>
    <TxnTime>2026-08-26T09:30:00.000+08:00</TxnTime>
  </Header>
  <Body>
    <Account>
      <AcctNo>123456789012345678</AcctNo>
      <Balance>12345.67</Balance>
    </Account>
  </Body>
</AccountInquiryResponse>`,
    new: `{
  "Header": { "TxnCode": "ACCT1002", "TxnTime": "2026-08-26T01:30:00.000Z" },
  "Body": { "Account": { "AcctNo": "123456789012345678", "Balance": "12345.67" } }
}`,
  },
  '餘額不一致（資料性高可疑）': {
    stateType: 'STATELESS',
    host: `<?xml version="1.0" encoding="UTF-8"?>
<AccountInquiryResponse>
  <Body>
    <Account><AcctNo>123456789012345678</AcctNo><Balance>12345.67</Balance></Account>
  </Body>
</AccountInquiryResponse>`,
    new: `{ "Body": { "Account": { "AcctNo": "123456789012345678", "Balance": "9999.00" } } }`,
  },
  '字段重命名（結構性）': {
    stateType: 'STATEFUL',
    host: `<?xml version="1.0" encoding="UTF-8"?>
<TransactionListResponse>
  <Body>
    <List>
      <Item><Seq>1</Seq><AcctName>陳大文</AcctName></Item>
    </List>
  </Body>
</TransactionListResponse>`,
    new: `{ "Body": { "List": [ { "Seq": "1", "CustomerName": "陳大文" } ] } }`,
  },
}

async function run() {
  initLayout()
  const root = document.getElementById('diff-test-root')
  root.innerHTML = ''

  // 載入伺服器 diff 規則（與執行一致的口徑）
  let rules = {}
  try {
    const cfg = await get('/api/config')
    rules = cfg.diffRules || {}
  } catch { /* 保留預設 */ }

  const host = el('textarea', { class: 'textarea', placeholder: '貼入主機（XML）報文…' })
  const fresh = el('textarea', { class: 'textarea', placeholder: '貼入微服務系統（JSON）報文…' })
  // 兩個輸入框平分左右；只填一邊時該輸入框佔滿整行並加高
  const hostWrap = el('div', {}, [el('label', { class: 'field', text: '主機系統輸出（XML）' }), host])
  const freshWrap = el('div', {}, [el('label', { class: 'field', text: '微服務系統輸出（JSON）' }), fresh])
  const pane = el('div', { class: 'dual-pane', style: 'margin-bottom:12px' }, [hostWrap, freshWrap])
  const syncPane = () => {
    const h = host.value.trim().length > 0
    const f = fresh.value.trim().length > 0
    const one = h !== f
    pane.classList.toggle('single', one)
    hostWrap.classList.toggle('pane-hidden', one && !h)
    freshWrap.classList.toggle('pane-hidden', one && !f)
  }
  host.addEventListener('input', syncPane)
  fresh.addEventListener('input', syncPane)
  const stateSel = el('select', { class: 'select' }, [
    el('option', { value: 'STATELESS', text: '無狀態' }),
    el('option', { value: 'STATEFUL', text: '有狀態' }),
  ])
  const out = el('div', {})

  const sampleBar = el('div', { class: 'flex flex-wrap', style: 'margin-bottom:10px' }, [
    el('span', { class: 'muted', text: '樣例：' }),
    ...Object.entries(SAMPLES).map(([label, s]) => el('button', {
      class: 'btn btn-sm',
      text: label,
      onclick: () => { host.value = s.host; fresh.value = s.new; stateSel.value = s.stateType; doCompare() },
    })),
  ])

  const doCompare = () => {
    syncPane()
    try {
      const diff = compare(host.value, fresh.value, { rules, stateType: stateSel.value })
      const fakeRun = {
        verdict: diff.verdict,
        stateNote: '',
        diff,
        hostResult: { rawBody: host.value },
        newResult: { rawBody: fresh.value },
      }
      out.innerHTML = ''
      out.append(renderRunResult(fakeRun))
    } catch (e) {
      out.innerHTML = ''
      out.append(el('div', { class: 'empty', text: `❌ ${e.message}` }))
    }
  }

  root.append(
    sampleBar,
    pane,
    el('div', { class: 'flex', style: 'margin-bottom:14px' }, [
      el('label', { class: 'field', style: 'margin:0', text: '接口類型：' }),
      stateSel,
      el('button', { class: 'btn btn-primary', text: '執行比對', onclick: doCompare }),
    ]),
    out
  )
}

run()
