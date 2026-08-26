/**
 * diff 引擎回歸測試（node --test，零依賴）
 * 覆蓋：XML 解析、正規化、陣列對齊、時間/數值/布爾、屬性合併、命名空間、
 *       動態欄位、包裝鍵、空值等價、有狀態合理性、判決邏輯
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseXML, decodeEntities, XMLError } from '../xml-parser.js'
import { xmlToTree, jsonToTree, flatten, displayPath } from '../normalize.js'
import { compare, DEFAULT_RULES } from '../diff.js'
import { canonicalNumber, parseTime } from '../comparators.js'

/* ========== XML 解析器 ========== */

test('XML：基本元素/屬性/文字', () => {
  const el = parseXML('<Response code="0000"><Name>張三</Name><Amt>100.50</Amt></Response>')
  assert.equal(el.tag, 'Response')
  assert.equal(el.attrs.code, '0000')
  assert.equal(el.children.length, 2)
  assert.equal(el.children[0].tag, 'Name')
  assert.equal(el.children[0].children[0].text, '張三')
})

test('XML：自我閉合、註釋、prolog、CDATA、實體', () => {
  const el = parseXML(
    '<?xml version="1.0"?><!-- 註釋 --><Root><Empty/><![CDATA[<raw>]]><Val>&lt;a&gt;&amp;&#65;</Val></Root>'
  )
  assert.equal(el.children[0].tag, 'Empty')
  assert.equal(el.children[0].selfClosing, true)
  assert.equal(el.children[1].text, '<raw>')
  assert.equal(el.children[2].children[0].text, '<a>&A')
})

test('XML：解析錯誤（未閉合 / 標籤不匹配）', () => {
  assert.throws(() => parseXML('<A><B></A>'), XMLError)
  assert.throws(() => parseXML('<A><B></B>'), XMLError)
  assert.throws(() => parseXML(''), XMLError)
  assert.throws(() => parseXML('<A><B></A></B>'), XMLError)
})

test('XML：重複兄弟標籤 → 陣列', () => {
  const t = xmlToTree('<List><Item n="1"/><Item n="2"/></List>')
  const item = t.children.get('Item')
  assert.equal(item.kind, 'arr')
  assert.equal(item.items.length, 2)
})

test('XML：命名空間前綴預設去除', () => {
  const t = xmlToTree('<soap:Envelope xmlns:soap="x"><soap:Body><Res>ok</Res></soap:Body></soap:Envelope>')
  assert.ok(t.children.has('Body'))
})

/* ========== 正規化 / 拍平 ========== */

test('拍平：路徑與索引', () => {
  const m = flatten(jsonToTree('{"a":{"b":[{"c":1},{"c":2}]}}'))
  assert.ok(m.has('a|b|0|c'))
  assert.ok(m.has('a|b|1|c'))
  assert.equal(m.get('a|b|0|c').raw, '1')
})

test('拍平：長度 1 陣列收斂（collapseSingle）', () => {
  const m = flatten(jsonToTree('{"items":[{"x":1}]}'))
  assert.ok(m.has('items|x'))
  assert.ok(!m.has('items|0|x'))
})

test('displayPath：人性化顯示', () => {
  assert.equal(displayPath(['data', 'items', '0', 'amount']), 'data.items[0].amount')
})

/* ========== 比較工具 ========== */

test('canonicalNumber：規範化與前導零防護', () => {
  assert.equal(canonicalNumber('00123'), null) // 帳號類，不誤合併
  assert.equal(canonicalNumber('123.4500'), '123.45')
  assert.equal(canonicalNumber('-0.5'), '-0.5')
  assert.equal(canonicalNumber('007'), null)
  assert.equal(canonicalNumber('0'), '0')
})

test('parseTime：多格式識別（TZ 無關）', () => {
  assert.equal(parseTime('20260826120000').epoch, Date.UTC(2026, 7, 26, 12, 0, 0))
  assert.equal(parseTime('2026-08-26T12:00:00+08:00').epoch, Date.UTC(2026, 7, 26, 4, 0, 0))
  assert.equal(parseTime('20260826').epoch, Date.UTC(2026, 7, 26))
  assert.equal(parseTime('2026-08-26T01:00:00Z').epoch, Date.UTC(2026, 7, 26, 1, 0, 0))
  assert.equal(parseTime('1724665200000').epoch, 1724665200000)
  assert.equal(parseTime('abc'), null)
})

/* ========== 語意相等（表示不同） ========== */

test('時間格式不同 → FORMAT 低可疑（TZ 無關）', () => {
  const r = compare(
    '<Resp><Time>2026-08-26T12:00:00.000Z</Time></Resp>',
    '{"Time":"20260826120000"}'
  )
  assert.equal(r.summary.total, 1)
  assert.equal(r.items[0].plausibility, 'FORMAT')
  assert.equal(r.items[0].suspicion, 'low')
  assert.equal(r.verdict, 'DIFF')
})

test('數值表示不同（123.00 vs 123）→ FORMAT；實質不同 → DATA', () => {
  const r1 = compare('<R><A>123.00</A></R>', '{"A":123}')
  assert.equal(r1.items[0].plausibility, 'FORMAT')
  const r2 = compare('<R><A>123.00</A></R>', '{"A":123.5}')
  assert.equal(r2.items[0].plausibility, 'DATA')
  assert.equal(r2.verdict, 'FAIL')
})

test('長數字精度保護（18 位）', () => {
  const r = compare('<R><Id>123456789012345678</Id></R>', '{"Id":"123456789012345679"}')
  assert.equal(r.items[0].precisionRisk, true)
  assert.equal(r.items[0].plausibility, 'DATA')
})

test('字串數字 ↔ number、布爾轉換', () => {
  const r1 = compare('<R><N>42.0</N></R>', '{"N":42}')
  assert.equal(r1.summary.total, 1)
  assert.equal(r1.items[0].plausibility, 'FORMAT')
  assert.equal(r1.verdict, 'DIFF')
  const r2 = compare('<R><F>true</F></R>', '{"F":false}')
  assert.equal(r2.items[0].plausibility, 'DATA')
  assert.equal(r2.verdict, 'FAIL')
})

/* ========== 結構性差異 ========== */

test('字段新增 / 刪除', () => {
  const r = compare(
    '<R><A>1</A><B>2</B></R>',
    '{"A":1,"C":3}'
  )
  const kinds = Object.fromEntries(r.items.map((i) => [i.path.join('.'), i.kind]))
  assert.equal(kinds.B, 'deleted')
  assert.equal(kinds.C, 'added')
  assert.equal(r.items.filter((i) => i.kind === 'deleted')[0].plausibility, 'STRUCTURAL')
  assert.equal(r.verdict, 'DIFF') // 結構性 → medium，非 FAIL
})

test('陣列對齊：同長度 → 無差異；長度不同 → 結構性差異', () => {
  const r1 = compare(
    '<List><Item><Seq>1</Seq></Item><Item><Seq>2</Seq></Item></List>',
    '{"Item":[{"Seq":"1"},{"Seq":"2"}]}'
  )
  assert.equal(r1.summary.total, 0)
  assert.equal(r1.verdict, 'PASS')
  const r2 = compare(
    '<List><Item><Seq>1</Seq></Item><Item><Seq>2</Seq></Item></List>',
    '{"Item":[{"Seq":"1"}]}'
  )
  assert.equal(r2.summary.total, 3) // 結構重組：2→1 元素
  assert.equal(r2.summary.deleted, 2)
  assert.equal(r2.summary.added, 1)
})

/* ========== 跨格式對齊 ========== */

test('XML 包裝層 vs JSON 單元素陣列 → 等價', () => {
  const r = compare(
    '<Resp><Items><Item><Seq>1</Seq></Item></Items></Resp>',
    '{"Items":{"Item":[{"Seq":"1"}]}}'
  )
  assert.equal(r.summary.total, 0)
  assert.equal(r.verdict, 'PASS')
})

test('XML 屬性 vs JSON 字段（attrMerge）', () => {
  const r = compare('<Resp><Item n="5"/></Resp>', '{"Item":{"n":5}}')
  assert.equal(r.summary.total, 0)
  assert.equal(r.verdict, 'PASS')
})

test('XML 屬性命中忽略欄位（attrMerge + ignoreFields 聯動）', () => {
  const r = compare('<Resp><Item traceId="abc"/></Resp>', '{"Item":{"traceId":"xyz"}}', {
    rules: { dynamicRegex: ['traceId'] },
  })
  assert.equal(r.summary.total, 0)
})

/* ========== 過濾規則 ========== */

test('wrapIgnoreKeys：包裝鍵不參與 diff', () => {
  const r = compare(
    '<resp><status>0</status><data><a>1</a></data></resp>',
    '{"status":0,"data":{"a":"1"}}',
    { rules: { wrapIgnoreKeys: ['status'] } }
  )
  assert.equal(r.summary.total, 0)
})

test('ignoreFields / dynamicRegex 忽略動態欄位', () => {
  const r = compare(
    '<Resp><Timestamp>2026-08-26T01:00:00Z</Timestamp><Nonce>aaa</Nonce><A>1</A></Resp>',
    '{"timestamp":"2026-08-26T02:00:00Z","nonce":"bbb","A":1}',
    { rules: { dynamicRegex: ['.*(imestamp|once)$'] } }
  )
  assert.equal(r.summary.total, 0)
})

test('大小寫敏感（鍵名）', () => {
  const r = compare('<R><Amt>1</Amt></R>', '{"amt":1}')
  assert.equal(r.summary.deleted, 1)
  assert.equal(r.summary.added, 1)
})

/* ========== 有狀態/無狀態 ========== */

test('STATEFUL：DATA 差異可疑度降為中', () => {
  const r = compare('<R><Bal>1000.00</Bal></R>', '{"Bal":900.00}', { stateType: 'STATEFUL' })
  assert.equal(r.items[0].suspicion, 'medium')
  assert.equal(r.verdict, 'DIFF')
  const r2 = compare('<R><Bal>1000.00</Bal></R>', '{"Bal":900.00}', { stateType: 'STATELESS' })
  assert.equal(r2.items[0].suspicion, 'high')
  assert.equal(r2.verdict, 'FAIL')
})

test('PASS / DIFF / FAIL 判決', () => {
  assert.equal(compare('<R><A>1</A></R>', '{"A":1}').verdict, 'PASS')
  assert.equal(compare('<R><A>1</A></R>', '{"A":2}').verdict, 'FAIL')
  assert.equal(compare('<R><A>1.00</A></R>', '{"A":1}').verdict, 'DIFF') // 僅表示不同
})

/* ========== 空值與錯誤 ========== */

test('emptyEqualsNull：null == 空串 == 缺失', () => {
  const r = compare('<R><A></A><B>x</B></R>', '{"A":null,"B":"x"}', { rules: { emptyEqualsNull: true } })
  assert.equal(r.summary.total, 0)
})

test('解析失敗 → 明確錯誤訊息', () => {
  assert.throws(() => compare('<R><A></R>', '{"A":1}'), /主機報文解析失敗/)
  assert.throws(() => compare('<R><A>1</A></R>', '{bad json'), /微服務系統報文解析失敗/)
})

/* ========== 陣列主鍵對齊（key 模式） ========== */

test('arrayMatchMode=key：主鍵對齊消除順序假差異', () => {
  const r = compare(
    '<List><Item><Seq>1</Seq><V>a</V></Item><Item><Seq>2</Seq><V>b</V></Item></List>',
    '{"Item":[{"Seq":"2","V":"b"},{"Seq":"1","V":"a"}]}',
    { rules: { arrayMatchMode: 'key', arrayMatchKeys: { 'Item': 'Seq' } } }
  )
  assert.equal(r.summary.total, 0)
  assert.equal(r.verdict, 'PASS')
})

test('XML 報文實例：完整遷移場景', () => {
  const host = `<?xml version="1.0" encoding="UTF-8"?>
<AccountInquiryResponse xmlns="urn:boc:host:acct">
  <Header>
    <TxnCode>ACCT1001</TxnCode>
    <TxnTime>2026-08-26T09:30:00.000+08:00</TxnTime>
  </Header>
  <Body>
    <Account>
      <AcctNo>123456789012345678</AcctNo>
      <AcctName>陳大文</AcctName>
      <Balance>12345.67</Balance>
      <Currency>HKD</Currency>
      <Status>A</Status>
      <Transactions>
        <Transaction>
          <Seq>1</Seq>
          <Amount>500.00</Amount>
          <Date>20260825</Date>
        </Transaction>
        <Transaction>
          <Seq>2</Seq>
          <Amount>1200.50</Amount>
          <Date>20260825</Date>
        </Transaction>
      </Transactions>
    </Account>
  </Body>
</AccountInquiryResponse>`
  const neu = `{
  "Header": {
    "TxnCode": "ACCT1001",
    "TxnTime": "2026-08-26T09:30:00.000+08:00"
  },
  "Body": {
    "Account": {
      "AcctNo": "123456789012345678",
      "AcctName": "陳大文",
      "Balance": "12345.67",
      "Currency": "HKD",
      "Status": "A",
      "Transactions": [
        { "Seq": "1", "Amount": "500.00", "Date": "20260825" },
        { "Seq": "2", "Amount": "1200.50", "Date": "20260825" }
      ]
    }
  }
}`
  const r = compare(host, neu, {
    stateType: 'STATEFUL',
    rules: {
      // 動態欄位（忽略大小寫）——遷移後這些字段必然不同
      dynamicRegex: ['(TxnTime|TxnCode)$', '.*(tStamp|nonce|traceId)$'],
    },
  })
  // TxnTime/TxnCode 被忽略後應無差異
  assert.equal(r.summary.total, 0)
  assert.equal(r.verdict, 'PASS')
})
