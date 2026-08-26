package com.boc.apitest.diff;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 極簡 XML 解析器（遞歸下降，零依賴）——與 shared/diff/xml-parser.js 逐行為移植。
 *
 * 輸出輕量 DOM：
 *   XmlElement: { tag, attrs, children: List<Object>（XmlElement | XmlText）, selfClosing }
 *
 * 刻意不支援：DTD 實體展開、外部實體、processing instructions 內容（銀行報文受控）。
 * 解析失敗時拋出 XMLError（含位置資訊）。
 */
public final class XmlParser {

    /** 解析失敗異常（含位置資訊），message 格式與 JS 版一致 */
    public static class XMLError extends RuntimeException {
        public final int pos;
        public XMLError(String message, int pos) {
            super(message + "（位置 " + pos + "）");
            this.pos = pos;
        }
    }

    public static final class XmlText {
        public String text;
        public XmlText(String text) { this.text = text; }
    }

    public static final class XmlElement {
        public String tag;
        public Map<String, String> attrs = new LinkedHashMap<>();
        public List<Object> children = new ArrayList<>();
        public boolean selfClosing;
    }

    private static final Map<String, String> ENTITIES = Map.of(
            "lt", "<", "gt", ">", "amp", "&", "quot", "\"", "apos", "'");

    public static String decodeEntities(String s) {
        if (s == null || !s.contains("&")) return s;
        StringBuilder out = new StringBuilder();
        int i = 0, n = s.length();
        while (i < n) {
            int amp = s.indexOf('&', i);
            if (amp < 0) { out.append(s, i, n); break; }
            out.append(s, i, amp);
            int semi = s.indexOf(';', amp);
            if (semi < 0) { out.append(s.substring(amp)); break; }
            String body = s.substring(amp + 1, semi);
            String decoded = null;
            if (!body.isEmpty() && body.charAt(0) == '#') {
                try {
                    int code = body.length() > 1 && (body.charAt(1) == 'x' || body.charAt(1) == 'X')
                            ? Integer.parseInt(body.substring(2), 16)
                            : Integer.parseInt(body.substring(1), 10);
                    if (code >= 0 && code <= 0x10ffff) decoded = new String(Character.toChars(code));
                } catch (NumberFormatException ignore) {
                    // 非法數值引用 → 原樣保留
                }
            } else {
                decoded = ENTITIES.get(body);
            }
            out.append(decoded != null ? decoded : s.substring(amp, semi + 1));
            i = semi + 1;
        }
        return out.toString();
    }

    public static XmlElement parseXML(String xml) {
        if (xml == null || xml.trim().isEmpty()) throw new XMLError("輸入為空", 0);
        return new Parser(xml).parseDocument();
    }

    private static final class Parser {
        private final String s;
        private int i;
        private final int n;

        Parser(String xml) { this.s = xml; this.i = 0; this.n = xml.length(); }

        private XMLError err(String msg) { return new XMLError(msg, this.i); }

        private boolean eof() { return i >= n; }

        private boolean startsWith(String str) {
            return s.startsWith(str, i);
        }

        private void skipWs() {
            while (i < n && Character.isWhitespace(s.charAt(i))) i++;
        }

        private void skipUntil(String marker) {
            int idx = s.indexOf(marker, i);
            if (idx < 0) throw err("未找到「" + marker + "」");
            i = idx;
        }

        private String parseName() {
            int start = i;
            while (i < n && isNameChar(s.charAt(i))) i++;
            if (i == start) throw err("期望名稱");
            return s.substring(start, i);
        }

        private static boolean isNameChar(char c) {
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '_' || c == ':' || c == '.' || c == '-';
        }

        XmlElement parseDocument() {
            skipMisc();
            XmlElement root = parseElement();
            skipMisc();
            if (!eof()) throw err("根元素後存在多餘內容");
            return root;
        }

        /** 跳過文件開頭 / 元素間的空格、prolog、註釋、DTD 宣告 */
        private void skipMisc() {
            for (;;) {
                skipWs();
                if (startsWith("<?")) { skipUntil("?>"); i += 2; continue; }
                if (startsWith("<!--")) { skipUntil("-->"); i += 3; continue; }
                if (startsWith("<!DOCTYPE")) { skipUntil(">"); i += 1; continue; }
                break;
            }
        }

        private char peek(int k) {
            return i + k < n ? s.charAt(i + k) : '\0';
        }

        private XmlElement parseElement() {
            if (i >= n || s.charAt(i) != '<') throw err("期望元素開始標籤 <");
            i++; // 越過 '<'
            skipWs();
            String tag = parseName();
            XmlElement el = new XmlElement();
            el.tag = tag;

            // 屬性
            for (;;) {
                skipWs();
                if (startsWith("/>")) {
                    i += 2;
                    el.selfClosing = true;
                    return el;
                }
                if (peek(0) == '>') {
                    i++;
                    break;
                }
                String name = parseName();
                skipWs();
                if (peek(0) != '=') throw err("屬性「" + name + "」缺少 =");
                i++;
                skipWs();
                char q = peek(0);
                if (q != '"' && q != '\'') throw err("屬性「" + name + "」的值需要引號");
                i++;
                int end = s.indexOf(q, i);
                if (end < 0) throw err("屬性「" + name + "」的值未閉合");
                el.attrs.put(name, decodeEntities(s.substring(i, end)));
                i = end + 1;
            }

            // 元素體
            for (;;) {
                // 文字節點
                int textStart = i;
                while (i < n && s.charAt(i) != '<') i++;
                if (i > textStart) {
                    String t = decodeEntities(s.substring(textStart, i));
                    if (!t.trim().isEmpty()) el.children.add(new XmlText(t));
                }
                if (eof()) throw err("元素 <" + tag + "> 未閉合");

                if (startsWith("</")) {
                    i += 2;
                    String closeTag = parseName();
                    if (!closeTag.equals(tag)) {
                        throw err("結束標籤 </" + closeTag + "> 與開始標籤 <" + tag + "> 不匹配");
                    }
                    skipWs();
                    if (peek(0) != '>') throw err("結束標籤格式錯誤");
                    i++;
                    return el;
                }
                if (startsWith("<!--")) { skipUntil("-->"); i += 3; continue; }
                if (startsWith("<![CDATA[")) {
                    int start = i + 9;
                    int idx = s.indexOf("]]>", start);
                    if (idx < 0) throw err("CDATA 未閉合");
                    el.children.add(new XmlText(s.substring(start, idx)));
                    i = idx + 3;
                    continue;
                }
                if (startsWith("<?")) { skipUntil("?>"); i += 2; continue; }
                // 子元素
                el.children.add(parseElement());
            }
        }
    }
}
