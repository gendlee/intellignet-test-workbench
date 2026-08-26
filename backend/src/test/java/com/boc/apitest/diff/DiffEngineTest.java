package com.boc.apitest.diff;

import com.boc.apitest.diff.Comparators.DiffRules;
import com.boc.apitest.diff.Comparators.ParsedTime;
import com.boc.apitest.diff.DiffModels.DiffResult;
import com.boc.apitest.diff.XmlParser.XmlElement;
import com.boc.apitest.diff.XmlParser.XmlText;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * diff 引擎回歸測試——shared/diff/__tests__/diff.test.js 的 JUnit 移植（28 條全覆蓋）。
 * 保證 Java 版與 JS 版口徑一致（解析、正規化、陣列對齊、時間/數值/布爾、
 * 屬性合併、命名空間、動態欄位、包裝鍵、空值等價、有狀態合理性、判決邏輯）。
 */
class DiffEngineTest {

    /* ========== 便捷包裝：與 JS compare(host, new, opts) 對齊 ========== */

    private static DiffResult compare(String host, String neu) {
        return DiffEngine.compare(host, neu, null, null, null);
    }

    private static DiffResult compare(String host, String neu, DiffRules rules) {
        return DiffEngine.compare(host, neu, rules, null, null);
    }

    private static DiffResult compare(String host, String neu, DiffRules rules, String stateType) {
        return DiffEngine.compare(host, neu, rules, stateType, null);
    }

    private static DiffRules rules() {
        return new DiffRules();
    }

    /* ========== XML 解析器 ========== */

    @Test
    void xmlBasic() {
        XmlElement el = XmlParser.parseXML("<Response code=\"0000\"><Name>張三</Name><Amt>100.50</Amt></Response>");
        assertEquals("Response", el.tag);
        assertEquals("0000", el.attrs.get("code"));
        assertEquals(2, el.children.size());
        assertEquals("Name", ((XmlElement) el.children.get(0)).tag);
        assertEquals("張三", ((XmlText) ((XmlElement) el.children.get(0)).children.get(0)).text);
    }

    @Test
    void xmlSelfClosingCommentsPrologCdataEntities() {
        XmlElement el = XmlParser.parseXML(
                "<?xml version=\"1.0\"?><!-- 註釋 --><Root><Empty/><![CDATA[<raw>]]><Val>&lt;a&gt;&amp;&#65;</Val></Root>");
        assertEquals("Empty", ((XmlElement) el.children.get(0)).tag);
        assertTrue(((XmlElement) el.children.get(0)).selfClosing);
        assertEquals("<raw>", ((XmlText) el.children.get(1)).text);
        assertEquals("<a>&A", ((XmlText) ((XmlElement) el.children.get(2)).children.get(0)).text);
    }

    @Test
    void xmlParseErrors() {
        assertThrows(XmlParser.XMLError.class, () -> XmlParser.parseXML("<A><B></A>"));
        assertThrows(XmlParser.XMLError.class, () -> XmlParser.parseXML("<A><B></B>"));
        assertThrows(XmlParser.XMLError.class, () -> XmlParser.parseXML(""));
        assertThrows(XmlParser.XMLError.class, () -> XmlParser.parseXML("<A><B></A></B>"));
    }

    @Test
    void xmlRepeatedSiblingsToArray() {
        UniNode t = Normalizer.xmlToTree("<List><Item n=\"1\"/><Item n=\"2\"/></List>", true);
        UniNode item = t.children.get("Item");
        assertEquals(UniNode.Kind.ARR, item.kind);
        assertEquals(2, item.items.size());
    }

    @Test
    void xmlNamespacePrefixStrip() {
        UniNode t = Normalizer.xmlToTree(
                "<soap:Envelope xmlns:soap=\"x\"><soap:Body><Res>ok</Res></soap:Body></soap:Envelope>", true);
        assertTrue(t.children.containsKey("Body"));
    }

    /* ========== 正規化 / 拍平 ========== */

    @Test
    void flattenPathsAndIndices() {
        Map<String, UniNode> m = Normalizer.flatten(
                Normalizer.jsonToTree("{\"a\":{\"b\":[{\"c\":1},{\"c\":2}]}}"), true);
        assertTrue(m.containsKey("a|b|0|c"));
        assertTrue(m.containsKey("a|b|1|c"));
        assertEquals("1", m.get("a|b|0|c").leaf.raw);
    }

    @Test
    void flattenCollapseSingle() {
        Map<String, UniNode> m = Normalizer.flatten(Normalizer.jsonToTree("{\"items\":[{\"x\":1}]}"), true);
        assertTrue(m.containsKey("items|x"));
        assertFalse(m.containsKey("items|0|x"));
    }

    @Test
    void displayPathHuman() {
        assertEquals("data.items[0].amount", Normalizer.displayPath(List.of("data", "items", "0", "amount")));
    }

    /* ========== 比較工具 ========== */

    @Test
    void canonicalNumberGuard() {
        assertNull(Comparators.canonicalNumber("00123")); // 帳號類，不誤合併
        assertEquals("123.45", Comparators.canonicalNumber("123.4500"));
        assertEquals("-0.5", Comparators.canonicalNumber("-0.5"));
        assertNull(Comparators.canonicalNumber("007"));
        assertEquals("0", Comparators.canonicalNumber("0"));
    }

    @Test
    void parseTimeFormats() {
        assertEquals(utc(2026, 8, 26, 12, 0, 0), Comparators.parseTime("20260826120000").epochMillis());
        assertEquals(utc(2026, 8, 26, 4, 0, 0), Comparators.parseTime("2026-08-26T12:00:00+08:00").epochMillis());
        assertEquals(utc(2026, 8, 26, 0, 0, 0), Comparators.parseTime("20260826").epochMillis());
        assertEquals(utc(2026, 8, 26, 1, 0, 0), Comparators.parseTime("2026-08-26T01:00:00Z").epochMillis());
        assertEquals(1724665200000L, Comparators.parseTime("1724665200000").epochMillis());
        assertNull(Comparators.parseTime("abc"));
    }

    private static long utc(int y, int mo, int d, int h, int mi, int s) {
        return java.time.LocalDateTime.of(y, mo, d, h, mi, s)
                .toInstant(java.time.ZoneOffset.UTC).toEpochMilli();
    }

    /* ========== 語意相等（表示不同） ========== */

    @Test
    void timeFormatDiffIsLow() {
        DiffResult r = compare(
                "<Resp><Time>2026-08-26T12:00:00.000Z</Time></Resp>",
                "{\"Time\":\"20260826120000\"}");
        assertEquals(1, r.getSummary().getTotal());
        assertEquals("FORMAT", r.getItems().get(0).getPlausibility());
        assertEquals("low", r.getItems().get(0).getSuspicion());
        assertEquals("DIFF", r.getVerdict());
    }

    @Test
    void numericFormatVsData() {
        DiffResult r1 = compare("<R><A>123.00</A></R>", "{\"A\":123}");
        assertEquals("FORMAT", r1.getItems().get(0).getPlausibility());
        DiffResult r2 = compare("<R><A>123.00</A></R>", "{\"A\":123.5}");
        assertEquals("DATA", r2.getItems().get(0).getPlausibility());
        assertEquals("FAIL", r2.getVerdict());
    }

    @Test
    void longNumberPrecisionRisk() {
        DiffResult r = compare("<R><Id>123456789012345678</Id></R>", "{\"Id\":\"123456789012345679\"}");
        assertTrue(r.getItems().get(0).isPrecisionRisk());
        assertEquals("DATA", r.getItems().get(0).getPlausibility());
    }

    @Test
    void stringNumberAndBoolean() {
        DiffResult r1 = compare("<R><N>42.0</N></R>", "{\"N\":42}");
        assertEquals(1, r1.getSummary().getTotal());
        assertEquals("FORMAT", r1.getItems().get(0).getPlausibility());
        assertEquals("DIFF", r1.getVerdict());
        DiffResult r2 = compare("<R><F>true</F></R>", "{\"F\":false}");
        assertEquals("DATA", r2.getItems().get(0).getPlausibility());
        assertEquals("FAIL", r2.getVerdict());
    }

    /* ========== 結構性差異 ========== */

    @Test
    void fieldAddedDeleted() {
        DiffResult r = compare("<R><A>1</A><B>2</B></R>", "{\"A\":1,\"C\":3}");
        Map<String, String> kinds = new java.util.HashMap<>();
        for (DiffModels.DiffItem i : r.getItems()) kinds.put(String.join(".", i.getPath()), i.getKind());
        assertEquals("deleted", kinds.get("B"));
        assertEquals("added", kinds.get("C"));
        assertEquals("STRUCTURAL", r.getItems().stream()
                .filter(i -> "deleted".equals(i.getKind())).findFirst().orElseThrow().getPlausibility());
        assertEquals("DIFF", r.getVerdict()); // 結構性 → medium，非 FAIL
    }

    @Test
    void arrayAlign() {
        DiffResult r1 = compare(
                "<List><Item><Seq>1</Seq></Item><Item><Seq>2</Seq></Item></List>",
                "{\"Item\":[{\"Seq\":\"1\"},{\"Seq\":\"2\"}]}");
        assertEquals(0, r1.getSummary().getTotal());
        assertEquals("PASS", r1.getVerdict());
        DiffResult r2 = compare(
                "<List><Item><Seq>1</Seq></Item><Item><Seq>2</Seq></Item></List>",
                "{\"Item\":[{\"Seq\":\"1\"}]}");
        assertEquals(3, r2.getSummary().getTotal()); // 結構重組：2→1 元素
        assertEquals(2, r2.getSummary().getDeleted());
        assertEquals(1, r2.getSummary().getAdded());
    }

    /* ========== 跨格式對齊 ========== */

    @Test
    void xmlWrapperVsJsonSingleArray() {
        DiffResult r = compare(
                "<Resp><Items><Item><Seq>1</Seq></Item></Items></Resp>",
                "{\"Items\":{\"Item\":[{\"Seq\":\"1\"}]}}");
        assertEquals(0, r.getSummary().getTotal());
        assertEquals("PASS", r.getVerdict());
    }

    @Test
    void attrMerge() {
        DiffResult r = compare("<Resp><Item n=\"5\"/></Resp>", "{\"Item\":{\"n\":5}}");
        assertEquals(0, r.getSummary().getTotal());
        assertEquals("PASS", r.getVerdict());
    }

    @Test
    void attrMergeWithIgnoreFields() {
        DiffRules rules = rules();
        rules.dynamicRegex = new java.util.ArrayList<>(List.of("traceId"));
        DiffResult r = compare("<Resp><Item traceId=\"abc\"/></Resp>", "{\"Item\":{\"traceId\":\"xyz\"}}", rules);
        assertEquals(0, r.getSummary().getTotal());
    }

    /* ========== 過濾規則 ========== */

    @Test
    void wrapIgnoreKeys() {
        DiffRules rules = rules();
        rules.wrapIgnoreKeys = new java.util.ArrayList<>(List.of("status"));
        DiffResult r = compare(
                "<resp><status>0</status><data><a>1</a></data></resp>",
                "{\"status\":0,\"data\":{\"a\":\"1\"}}", rules);
        assertEquals(0, r.getSummary().getTotal());
    }

    @Test
    void dynamicRegexIgnore() {
        DiffRules rules = rules();
        rules.dynamicRegex = new java.util.ArrayList<>(List.of(".*(imestamp|once)$"));
        DiffResult r = compare(
                "<Resp><Timestamp>2026-08-26T01:00:00Z</Timestamp><Nonce>aaa</Nonce><A>1</A></Resp>",
                "{\"timestamp\":\"2026-08-26T02:00:00Z\",\"nonce\":\"bbb\",\"A\":1}", rules);
        assertEquals(0, r.getSummary().getTotal());
    }

    @Test
    void caseSensitiveKeys() {
        DiffResult r = compare("<R><Amt>1</Amt></R>", "{\"amt\":1}");
        assertEquals(1, r.getSummary().getDeleted());
        assertEquals(1, r.getSummary().getAdded());
    }

    /* ========== 有狀態/無狀態 ========== */

    @Test
    void statefulDowngradesSuspicion() {
        DiffResult r = compare("<R><Bal>1000.00</Bal></R>", "{\"Bal\":900.00}", null, "STATEFUL");
        assertEquals("medium", r.getItems().get(0).getSuspicion());
        assertEquals("DIFF", r.getVerdict());
        DiffResult r2 = compare("<R><Bal>1000.00</Bal></R>", "{\"Bal\":900.00}", null, "STATELESS");
        assertEquals("high", r2.getItems().get(0).getSuspicion());
        assertEquals("FAIL", r2.getVerdict());
    }

    @Test
    void verdicts() {
        assertEquals("PASS", compare("<R><A>1</A></R>", "{\"A\":1}").getVerdict());
        assertEquals("FAIL", compare("<R><A>1</A></R>", "{\"A\":2}").getVerdict());
        assertEquals("DIFF", compare("<R><A>1.00</A></R>", "{\"A\":1}").getVerdict()); // 僅表示不同
    }

    /* ========== 空值與錯誤 ========== */

    @Test
    void emptyEqualsNull() {
        DiffRules rules = rules();
        rules.emptyEqualsNull = true;
        DiffResult r = compare("<R><A></A><B>x</B></R>", "{\"A\":null,\"B\":\"x\"}", rules);
        assertEquals(0, r.getSummary().getTotal());
    }

    @Test
    void parseErrors() {
        IllegalArgumentException e1 = assertThrows(IllegalArgumentException.class,
                () -> compare("<R><A></R>", "{\"A\":1}"));
        assertTrue(e1.getMessage().contains("主機報文解析失敗"));
        IllegalArgumentException e2 = assertThrows(IllegalArgumentException.class,
                () -> compare("<R><A>1</A></R>", "{bad json"));
        assertTrue(e2.getMessage().contains("微服務系統報文解析失敗"));
    }

    /* ========== 陣列主鍵對齊（key 模式） ========== */

    @Test
    void arrayMatchKey() {
        DiffRules rules = rules();
        rules.arrayMatchMode = "key";
        rules.arrayMatchKeys = new java.util.HashMap<>();
        rules.arrayMatchKeys.put("Item", "Seq");
        DiffResult r = compare(
                "<List><Item><Seq>1</Seq><V>a</V></Item><Item><Seq>2</Seq><V>b</V></Item></List>",
                "{\"Item\":[{\"Seq\":\"2\",\"V\":\"b\"},{\"Seq\":\"1\",\"V\":\"a\"}]}", rules);
        assertEquals(0, r.getSummary().getTotal());
        assertEquals("PASS", r.getVerdict());
    }

    @Test
    void fullXmlScenario() {
        String host = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<AccountInquiryResponse xmlns=\"urn:boc:host:acct\">\n"
                + "  <Header>\n"
                + "    <TxnCode>ACCT1001</TxnCode>\n"
                + "    <TxnTime>2026-08-26T09:30:00.000+08:00</TxnTime>\n"
                + "  </Header>\n"
                + "  <Body>\n"
                + "    <Account>\n"
                + "      <AcctNo>123456789012345678</AcctNo>\n"
                + "      <AcctName>陳大文</AcctName>\n"
                + "      <Balance>12345.67</Balance>\n"
                + "      <Currency>HKD</Currency>\n"
                + "      <Status>A</Status>\n"
                + "      <Transactions>\n"
                + "        <Transaction>\n"
                + "          <Seq>1</Seq>\n"
                + "          <Amount>500.00</Amount>\n"
                + "          <Date>20260825</Date>\n"
                + "        </Transaction>\n"
                + "        <Transaction>\n"
                + "          <Seq>2</Seq>\n"
                + "          <Amount>1200.50</Amount>\n"
                + "          <Date>20260825</Date>\n"
                + "        </Transaction>\n"
                + "      </Transactions>\n"
                + "    </Account>\n"
                + "  </Body>\n"
                + "</AccountInquiryResponse>";
        String neu = "{\n"
                + "  \"Header\": {\n"
                + "    \"TxnCode\": \"ACCT1001\",\n"
                + "    \"TxnTime\": \"2026-08-26T09:30:00.000+08:00\"\n"
                + "  },\n"
                + "  \"Body\": {\n"
                + "    \"Account\": {\n"
                + "      \"AcctNo\": \"123456789012345678\",\n"
                + "      \"AcctName\": \"陳大文\",\n"
                + "      \"Balance\": \"12345.67\",\n"
                + "      \"Currency\": \"HKD\",\n"
                + "      \"Status\": \"A\",\n"
                + "      \"Transactions\": [\n"
                + "        { \"Seq\": \"1\", \"Amount\": \"500.00\", \"Date\": \"20260825\" },\n"
                + "        { \"Seq\": \"2\", \"Amount\": \"1200.50\", \"Date\": \"20260825\" }\n"
                + "      ]\n"
                + "    }\n"
                + "  }\n"
                + "}";
        DiffRules rules = rules();
        rules.dynamicRegex = new java.util.ArrayList<>(List.of("(TxnTime|TxnCode)$", ".*(tStamp|nonce|traceId)$"));
        DiffResult r = compare(host, neu, rules, "STATEFUL");
        assertEquals(0, r.getSummary().getTotal());
        assertEquals("PASS", r.getVerdict());
    }
}
