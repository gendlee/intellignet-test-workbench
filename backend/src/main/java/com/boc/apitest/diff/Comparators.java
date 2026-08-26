package com.boc.apitest.diff;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 比較規則集：值比較、時間/數值/布爾正規化、合理性分級、機器理由文案。
 * 與 shared/diff/comparators.js 逐行為移植。
 *
 * 設計原則：永不靜默吞掉差異——「僅表示方式不同」的差異仍會輸出為 FORMAT 低可疑
 * 條目（附理由），只是不影響 PASS/FAIL 判決。
 */
public final class Comparators {

    /** 比較規則（對齊 DEFAULT_RULES） */
    public static class DiffRules {
        public String arrayMatchMode = "index";
        public Map<String, String> arrayMatchKeys = new java.util.LinkedHashMap<>();
        public java.util.List<String> ignoreFields = new java.util.ArrayList<>();
        public java.util.List<String> dynamicRegex = new java.util.ArrayList<>();
        public String numeric = "strict";
        public double numericTolerance = 1e-9;
        public int longNumberGuard = 15;
        public boolean timeNormalize = true;
        public boolean collapseSingleArray = true;
        public boolean attrMerge = true;
        public boolean namespaceInsensitive = true;
        public boolean emptyEqualsNull = false;
        public java.util.List<String> wrapIgnoreKeys = new java.util.ArrayList<>();
    }

    public static final DiffRules DEFAULT_RULES = new DiffRules();

    /** 值比較結果 */
    public static class CompareOutcome {
        public boolean equal;
        public String plausibility;   // FORMAT | DATA（equal=false 且 DATA = 實質不同）
        public boolean informational; // 資訊性表示差異（時間/數值/布爾格式）
        public boolean precisionRisk;
        public String reason;
    }

    /** parseTime 結果 */
    public record ParsedTime(long epochMillis, String kind) {}

    private Comparators() {}

    /* ---------- 正規化工具 ---------- */

    private static final Pattern INT_RE = Pattern.compile("^-?\\d+$");
    private static final Pattern LEAD_ZERO_RE = Pattern.compile("^-?0\\d");
    private static final Pattern ALL_ZERO_RE = Pattern.compile("^-?0+$");
    private static final Pattern STRIP_LEAD_ZERO_RE = Pattern.compile("^(-?)0+(?=\\d)");
    private static final Pattern DECIMAL_RE = Pattern.compile("^-?\\d+\\.\\d+$");
    private static final Pattern INT_PART_LEAD_RE = Pattern.compile("^-?0\\d");
    private static final Pattern STRIP_INT_LEAD_RE = Pattern.compile("^[+-]?0+");

    /**
     * 乾淨數字的規範化字串；非乾淨數字（如含前導零的帳號）回傳 null。
     * 對齊 JS canonicalNumber：整數去前導零、小數去尾零、前導零防護。
     */
    public static String canonicalNumber(Object value) {
        if (value instanceof Number num) {
            double d = num.doubleValue();
            if (!Double.isFinite(d)) return null;
            if (d == 0) return "0";
            if (d == Math.floor(d) && Math.abs(d) < 1e15) return String.valueOf(num.longValue());
            return String.valueOf(d);
        }
        String s = String.valueOf(value).trim();
        if (INT_RE.matcher(s).matches()) {
            // 前導零（"007"）→ 非乾淨數字，防帳號類欄位被誤合併
            if (LEAD_ZERO_RE.matcher(s).find() && !ALL_ZERO_RE.matcher(s).find()) return null;
            return STRIP_LEAD_ZERO_RE.matcher(s).replaceAll("$1");
        }
        Matcher dm = DECIMAL_RE.matcher(s);
        if (dm.matches()) {
            String[] parts = s.split("\\.");
            String intPart = parts[0];
            String frac = parts[1];
            if (INT_PART_LEAD_RE.matcher(intPart.replace("-", "")).find()) return null;
            String fracTrim = frac.replaceAll("0+$", "");
            String sign = intPart.startsWith("-") ? "-" : "";
            String intClean = STRIP_INT_LEAD_RE.matcher(intPart).replaceAll("");
            if (intClean.isEmpty()) intClean = "0";
            return fracTrim.isEmpty() ? sign + intClean : sign + intClean + "." + fracTrim;
        }
        return null;
    }

    /* ---------- 時間正規化 ---------- */

    private static final Pattern EPOCH_S = Pattern.compile("^\\d{10}$");
    private static final Pattern EPOCH_MS = Pattern.compile("^\\d{13}$");
    private static final Pattern ISO_RE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:?\\d{2})?$");
    private static final Pattern OFFSET_END = Pattern.compile("([+-]\\d{2}:?\\d{2})$");
    private static final Pattern COMPACT_DT = Pattern.compile("^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$");
    private static final Pattern COMPACT_D = Pattern.compile("^(\\d{4})(\\d{2})(\\d{2})$");
    private static final Pattern DATE_DASH = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})$");

    /** 寬鬆 ISO：秒/毫秒可選、偏移 +HH:mm（或 Z），對齊 JS Date.parse 的容錯 */
    private static final DateTimeFormatter ISO_LENIENT = new java.time.format.DateTimeFormatterBuilder()
            .appendPattern("uuuu-MM-dd'T'HH:mm")
            .optionalStart().appendPattern(":ss").optionalEnd()
            .optionalStart().appendFraction(java.time.temporal.ChronoField.NANO_OF_SECOND, 0, 9, true).optionalEnd()
            .appendOffset("+HH:mm", "Z")
            .toFormatter();

    /**
     * 時間正規化：ISO8601、yyyy-MM-dd HH:mm:ss、yyyy/MM/dd、yyyyMMddHHmmss、yyyyMMdd、epoch 秒/毫秒。
     * 語義對齊 JS parseTime + Date.parse：無時區偏移的 ISO 視為本地時間（V8 行為）。
     */
    public static ParsedTime parseTime(String str) {
        String s = str.trim();
        if (s.isEmpty()) return null;
        if (EPOCH_S.matcher(s).matches()) return new ParsedTime(Long.parseLong(s) * 1000, "epoch-s");
        if (EPOCH_MS.matcher(s).matches()) return new ParsedTime(Long.parseLong(s), "epoch-ms");
        if (ISO_RE.matcher(s).matches()) {
            String t = s.replace(' ', 'T');
            try {
                if (t.endsWith("Z")) {
                    return new ParsedTime(ISO_LENIENT.parse(t, Instant::from).toEpochMilli(), "iso");
                }
                Matcher m = OFFSET_END.matcher(t);
                if (m.find()) {
                    String body = t.substring(0, m.start());
                    String off = m.group(1).replace(":", "");
                    String normalized = off.substring(0, 1) + off.substring(1, 3) + ":" + off.substring(3);
                    return new ParsedTime(ISO_LENIENT.parse(body + normalized, Instant::from).toEpochMilli(), "iso");
                }
                LocalDateTime ldt = LocalDateTime.parse(t);
                return new ParsedTime(ldt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(), "iso");
            } catch (Exception e) {
                return null;
            }
        }
        Matcher m = COMPACT_DT.matcher(s);
        if (m.matches()) {
            return new ParsedTime(utc(m, 1, 2, 3, 4, 5, 6), "compact-dt");
        }
        m = COMPACT_D.matcher(s);
        if (m.matches()) {
            return new ParsedTime(utcDate(m, 1, 2, 3), "compact-d");
        }
        m = DATE_DASH.matcher(s);
        if (m.matches()) {
            return new ParsedTime(utcDate(m, 1, 2, 3), "date");
        }
        return null;
    }

    private static long utc(Matcher m, int y, int mo, int d, int h, int mi, int sec) {
        LocalDateTime ldt = LocalDateTime.of(
                Integer.parseInt(m.group(y)),
                Integer.parseInt(m.group(mo)),
                Integer.parseInt(m.group(d)),
                Integer.parseInt(m.group(h)),
                Integer.parseInt(m.group(mi)),
                Integer.parseInt(m.group(sec)));
        return ldt.toInstant(ZoneOffset.UTC).toEpochMilli();
    }

    private static long utcDate(Matcher m, int y, int mo, int d) {
        LocalDateTime ldt = LocalDateTime.of(
                Integer.parseInt(m.group(y)),
                Integer.parseInt(m.group(mo)),
                Integer.parseInt(m.group(d)),
                0, 0, 0);
        return ldt.toInstant(ZoneOffset.UTC).toEpochMilli();
    }

    /* ---------- 值比較 ---------- */

    private static final Map<String, Boolean> BOOL_MAP = Map.of("true", true, "false", false);

    /**
     * 比較兩個 leaf：
     * - equal=true 且 plausibility='FORMAT'：語意相等但表示方式不同（資訊性差異）
     * - equal=false 且 plausibility='DATA'：實質不同
     */
    public static CompareOutcome compareValues(Leaf h, Leaf n, DiffRules rules) {
        String hr = h.raw.trim();
        String nr = n.raw.trim();
        String hType = h.type;
        String nType = n.type;
        CompareOutcome out = new CompareOutcome();

        // 空值等價
        if (rules.emptyEqualsNull) {
            boolean hEmpty = "null".equals(hType) || hr.isEmpty();
            boolean nEmpty = "null".equals(nType) || nr.isEmpty();
            if (hEmpty && nEmpty) { out.equal = true; out.plausibility = "FORMAT"; return out; }
        }

        // 字串完全相等
        if (hr.equals(nr)) { out.equal = true; return out; }

        // 時間歸一（兩端都解析成功才啟用）
        if (rules.timeNormalize) {
            ParsedTime ht = parseTime(hr);
            ParsedTime nt = parseTime(nr);
            if (ht != null && nt != null) {
                if (ht.epochMillis() == nt.epochMillis()) {
                    out.equal = true;
                    out.plausibility = "FORMAT";
                    out.informational = true;
                    out.reason = "僅時間表示方式不同：" + h.raw + " vs " + n.raw;
                    return out;
                }
                out.equal = false;
                out.plausibility = "DATA";
                out.reason = "時間值不同：" + h.raw + " vs " + n.raw;
                return out;
            }
        }

        // 數字比較（含字串數字 ↔ number 的 typeCoerce）
        String hNum = canonicalNumber(hr);
        String nNum = canonicalNumber(nr);
        if (hNum != null && nNum != null) {
            // 長數字精度保護：有效位數超過門檻 → 強制字串比較
            int hSig = hr.replaceAll("[^0-9]", "").replaceAll("^0+", "").length();
            int nSig = nr.replaceAll("[^0-9]", "").replaceAll("^0+", "").length();
            if (Math.max(hSig, nSig) > rules.longNumberGuard) {
                out.equal = false;
                out.plausibility = "DATA";
                out.precisionRisk = true;
                out.reason = "長數字超出精度範圍（>" + rules.longNumberGuard + " 位），按字串比較：" + h.raw + " vs " + n.raw;
                return out;
            }
            boolean equal;
            if ("strict".equals(rules.numeric)) {
                equal = hNum.equals(nNum);
            } else {
                double a = Double.parseDouble(hNum);
                double b = Double.parseDouble(nNum);
                equal = a == b || Math.abs(a - b) <= rules.numericTolerance * Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
            }
            if (equal) {
                out.equal = true;
                out.plausibility = "FORMAT";
                out.informational = true;
                out.reason = "數值表示方式不同：" + h.raw + " vs " + n.raw;
                return out;
            }
            out.equal = false;
            out.plausibility = "DATA";
            out.reason = "數值不同：" + h.raw + " vs " + n.raw;
            return out;
        }

        // 布爾比較
        Boolean hb = "boolean".equals(hType) ? h.raw.equals("true") : BOOL_MAP.get(hr);
        Boolean nb = "boolean".equals(nType) ? n.raw.equals("true") : BOOL_MAP.get(nr);
        if (hb != null && nb != null) {
            if (hb.equals(nb)) {
                out.equal = true;
                out.plausibility = "FORMAT";
                out.informational = true;
                out.reason = "布爾表示方式不同：" + h.raw + " vs " + n.raw;
                return out;
            }
            out.equal = false;
            out.plausibility = "DATA";
            out.reason = "布爾值不同：" + h.raw + " vs " + n.raw;
            return out;
        }

        // 其他 → 實質不同
        out.equal = false;
        out.plausibility = "DATA";
        out.reason = "值不同：" + h.raw + " vs " + n.raw;
        return out;
    }

    /* ---------- 合理性分級 ---------- */

    /** FORMAT → low；STRUCTURAL → medium；DATA：無狀態接口 → high、有狀態接口 → medium */
    public static String suspicionOf(String plausibility, String stateType) {
        if ("FORMAT".equals(plausibility)) return "low";
        if ("STRUCTURAL".equals(plausibility)) return "medium";
        return "STATEFUL".equals(stateType) ? "medium" : "high";
    }

    public static String suspicionReason(String plausibility, String stateType) {
        if ("FORMAT".equals(plausibility)) return "僅表示方式不同，建議確認遷移後格式是否可接受";
        if ("STRUCTURAL".equals(plausibility)) return "字段結構變化，請確認遷移後接口契約是否調整";
        if ("STATEFUL".equals(stateType)) {
            return "接口有狀態，差異可能源於前置狀態（餘額/流水/會話），建議核對前置條件後重跑驗證";
        }
        return "無狀態接口同輸入應同輸出，建議復核報文與數據";
    }
}
