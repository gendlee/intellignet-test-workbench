/**
 * 極簡 XML 解析器（遞歸下降，零依賴，瀏覽器 / Node 通用）
 *
 * 輸出輕量 DOM：
 *   element: { tag, attrs: {name: value}, children: [node], selfClosing }
 *   text:    { text }
 *
 * 刻意不支援：DTD 實體展開、外部實體、processing instructions 內容（銀行報文受控）。
 * 解析失敗時拋出 XMLError（含位置資訊），呼叫方可選擇降級到瀏覽器 DOMParser。
 */

export class XMLError extends Error {
  constructor(message, pos) {
    super(`${message}（位置 ${pos}）`)
    this.name = 'XMLError'
    this.pos = pos
  }
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s) {
  if (!s.includes('&')) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      if (!Number.isNaN(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code)
      }
      return m
    }
    return ENTITIES[body] ?? m
  })
}

export function parseXML(xml) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new XMLError('輸入為空', 0)
  }
  return new Parser(xml).parseDocument()
}

class Parser {
  constructor(xml) {
    this.s = xml
    this.i = 0
    this.n = xml.length
  }

  err(msg) {
    throw new XMLError(msg, this.i)
  }

  eof() {
    return this.i >= this.n
  }

  startsWith(str) {
    return this.s.startsWith(str, this.i)
  }

  skipWs() {
    while (this.i < this.n && /\s/.test(this.s[this.i])) this.i++
  }

  parseDocument() {
    this.skipMisc()
    const root = this.parseElement()
    this.skipMisc()
    if (!this.eof()) this.err('根元素後存在多餘內容')
    return root
  }

  /** 跳過文件開頭 / 元素間的空格、prolog、註釋、DTD 宣告 */
  skipMisc() {
    for (;;) {
      this.skipWs()
      if (this.startsWith('<?')) {
        this.skipUntil('?>')
        this.i += 2
        continue
      }
      if (this.startsWith('<!--')) {
        this.skipUntil('-->')
        this.i += 3
        continue
      }
      if (this.startsWith('<!DOCTYPE')) {
        this.skipUntil('>')
        this.i += 1
        continue
      }
      break
    }
  }

  skipUntil(marker) {
    const idx = this.s.indexOf(marker, this.i)
    if (idx < 0) this.err(`未找到「${marker}」`)
    this.i = idx
  }

  parseName() {
    const start = this.i
    while (this.i < this.n && /[A-Za-z0-9_:.\-]/.test(this.s[this.i])) this.i++
    if (this.i === start) this.err('期望名稱')
    return this.s.slice(start, this.i)
  }

  parseElement() {
    if (this.s[this.i] !== '<') this.err('期望元素開始標籤 <')
    this.i++ // 越過 '<'
    this.skipWs()
    const tag = this.parseName()
    const attrs = {}

    // 屬性
    for (;;) {
      this.skipWs()
      if (this.startsWith('/>')) {
        this.i += 2
        return { tag, attrs, children: [], selfClosing: true }
      }
      if (this.peek() === '>') {
        this.i++
        break
      }
      const name = this.parseName()
      this.skipWs()
      if (this.peek() !== '=') this.err(`屬性「${name}」缺少 =`)
      this.i++
      this.skipWs()
      const q = this.peek()
      if (q !== '"' && q !== "'") this.err(`屬性「${name}」的值需要引號`)
      this.i++
      const end = this.s.indexOf(q, this.i)
      if (end < 0) this.err(`屬性「${name}」的值未閉合`)
      attrs[name] = decodeEntities(this.s.slice(this.i, end))
      this.i = end + 1
    }

    // 元素體
    const children = []
    for (;;) {
      // 文字節點
      const textStart = this.i
      while (this.i < this.n && this.s[this.i] !== '<') this.i++
      if (this.i > textStart) {
        const t = decodeEntities(this.s.slice(textStart, this.i))
        if (t.trim()) children.push({ text: t })
      }
      if (this.eof()) this.err(`元素 <${tag}> 未閉合`)

      if (this.startsWith('</')) {
        this.i += 2
        const closeTag = this.parseName()
        if (closeTag !== tag) {
          this.err(`結束標籤 </${closeTag}> 與開始標籤 <${tag}> 不匹配`)
        }
        this.skipWs()
        if (this.peek() !== '>') this.err('結束標籤格式錯誤')
        this.i++
        return { tag, attrs, children, selfClosing: false }
      }
      if (this.startsWith('<!--')) {
        this.skipUntil('-->')
        this.i += 3
        continue
      }
      if (this.startsWith('<![CDATA[')) {
        const start = this.i + 9
        const idx = this.s.indexOf(']]>', start)
        if (idx < 0) this.err('CDATA 未閉合')
        children.push({ text: this.s.slice(start, idx) })
        this.i = idx + 3
        continue
      }
      if (this.startsWith('<?')) {
        this.skipUntil('?>')
        this.i += 2
        continue
      }
      // 子元素
      children.push(this.parseElement())
    }
  }

  peek(k = 0) {
    return this.s[this.i + k] ?? ''
  }
}
