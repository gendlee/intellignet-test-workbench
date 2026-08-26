package com.boc.apitest.service;

import com.boc.apitest.common.BizException;
import com.boc.apitest.common.TimeUtil;
import com.boc.apitest.diff.Comparators;
import com.boc.apitest.diff.DiffEngine;
import com.boc.apitest.diff.DiffModels.DiffResult;
import com.boc.apitest.diff.XmlParser;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Case.HeaderDef;
import com.boc.apitest.entity.Case.NewInput;
import com.boc.apitest.entity.Misc.Config;
import com.boc.apitest.entity.Run;
import com.boc.apitest.entity.StressPlan;
import com.boc.apitest.entity.StressRun;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.util.StdDateFormat;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 執行器（mock/generators.js 的 Java 移植，逐行為一致）：
 * - aiGenerate：主機 XML 請求 → 微服務系統 HTTP/JSON
 * - buildHostResponse / buildNewResponse：依 profile 產出兩側回應 + diff
 * - runCase：單條執行（compare 模式走 shared/diff 引擎；http 模式按狀態碼）
 * - buildStressRun：壓測曲線生成
 *
 * 種子化偽隨機（mulberry32 + djb2）逐位移植，保證與 JS 版輸出一致。
 */
@Service
@RequiredArgsConstructor
public class GeneratorService {

    private final SeqService seq;

    /* ---------- 工具 ---------- */

    /** djb2 雜湊（對齊 generators.js hash：32 位無號） */
    public static long hash(String str) {
        long h = 5381;
        for (int i = 0; i < str.length(); i++) {
            h = ((h << 5) + h + str.charAt(i)) & 0xFFFFFFFFL;
        }
        return h;
    }

    /** mulberry32 種子化偽隨機（與 JS 版位元組一致） */
    public static final class Rng {
        private int a;

        public Rng(long seed) {
            this.a = (int) (seed & 0xFFFFFFFFL);
        }

        public double next() {
            a = (a + 0x6d2b79f5); // 32 位環繞
            int t = (a ^ (a >>> 15)) * (1 | a);
            t = (t + ((t ^ (t >>> 7)) * (61 | t))) ^ t;
            return (double) ((long) (t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
        }
    }

    /** 對齊 JS camel()：首字母小寫、-x → X */
    static String camel(String tag) {
        StringBuilder sb = new StringBuilder(tag);
        if (!sb.isEmpty() && sb.charAt(0) >= 'A' && sb.charAt(0) <= 'Z') {
            sb.setCharAt(0, Character.toLowerCase(sb.charAt(0)));
        }
        for (int i = 0; i < sb.length() - 1; i++) {
            if (sb.charAt(i) == '-' && sb.charAt(i + 1) >= 'a' && sb.charAt(i + 1) <= 'z') {
                sb.setCharAt(i + 1, Character.toUpperCase(sb.charAt(i + 1)));
                sb.deleteCharAt(i);
                i--;
            }
        }
        return sb.toString();
    }

    /** 對齊 JS toFixed(2)（正值場景），用 %.2f HALF_UP */
    static String fmt2(double v) {
        return String.format(Locale.ROOT, "%.2f", v);
    }

    private static String pad2(int n) {
        return String.format("%02d", n);
    }

    /* ---------- AI 生成：主機 XML 請求 → 微服務系統 HTTP/JSON ---------- */

    /**
     * @param hostXml        主機請求 XML
     * @param urlTemplate    配置 URL 模板
     * @param defaultHeaders 配置默認請求頭
     * @param envBaseUrl     當前環境 baseUrl（存在時取代模板首段）
     * @return newInput { url, method, headers, body }
     */
    public NewInput aiGenerate(String hostXml, List<Config.UrlTemplateSeg> urlTemplate,
                               List<HeaderDef> defaultHeaders, String envBaseUrl) {
        XmlParser.XmlElement root;
        try {
            root = XmlParser.parseXML(hostXml);
        } catch (XmlParser.XMLError e) {
            throw new BizException(4000, "主機請求 XML 解析失敗：" + e.getMessage());
        }
        String txnCode = findTxnCode(root);
        String modulePath = camel(root.tag);

        // URL：環境 baseUrl（存在時取代模板首段，即主機段）+ 其餘模板段 → 附加模組路徑/交易碼
        List<String> segs = new ArrayList<>();
        if (urlTemplate != null) {
            for (Config.UrlTemplateSeg s : urlTemplate) {
                if (s != null && s.getValue() != null && !s.getValue().isEmpty()) {
                    segs.add(s.getValue().replaceAll("/+$", ""));
                }
            }
        }
        String base = ((envBaseUrl != null && !envBaseUrl.isEmpty()) ? envBaseUrl
                : (segs.isEmpty() ? "" : segs.get(0))).replaceAll("/+$", "");
        // 對齊 JS：envBaseUrl 存在時 rest = segs.slice(1)（首段為主機段，被環境 baseUrl 取代）；
        // 僅一段時 slice(1) 為空陣列 → rest = ""
        List<String> restSegs = (envBaseUrl != null && !envBaseUrl.isEmpty())
                ? segs.subList(1, segs.size()) : segs;
        String rest = String.join("/", restSegs);
        String url = (base + "/" + rest + "/" + modulePath + "/" + txnCode).replaceAll("([^:])/+", "$1/");

        Object body = elToJson(root);
        NewInput out = new NewInput();
        out.setUrl(url);
        out.setMethod("POST");
        List<HeaderDef> headers = new ArrayList<>();
        if (defaultHeaders != null) {
            for (HeaderDef h : defaultHeaders) {
                if (h != null && !Boolean.FALSE.equals(h.getEnabled())) {
                    HeaderDef hd = new HeaderDef();
                    hd.setName(h.getName());
                    hd.setValue(h.getValue());
                    headers.add(hd);
                }
            }
        }
        out.setHeaders(headers);
        out.setBody(prettyJson(body));
        return out;
    }

    private String findTxnCode(XmlParser.XmlElement root) {
        String[] found = {null};
        walkTxn(root, found);
        if (found[0] != null) return found[0];
        return camel(root.tag);
    }

    private void walkTxn(XmlParser.XmlElement el, String[] found) {
        if (found[0] != null) return;
        if (el.tag.toLowerCase(Locale.ROOT).equals("txncode")) {
            StringBuilder sb = new StringBuilder();
            for (Object c : el.children) {
                if (c instanceof XmlParser.XmlText t) sb.append(t.text);
            }
            found[0] = sb.toString().trim();
            return;
        }
        for (Object c : el.children) {
            if (c instanceof XmlParser.XmlElement child) walkTxn(child, found);
        }
    }

    /** XML 元素 → JSON（對齊 elToJson：camel 鍵、重複標籤 → 陣列、文字 → #text） */
    static Object elToJson(XmlParser.XmlElement el) {
        List<String> textParts = new ArrayList<>();
        List<XmlParser.XmlElement> elChildren = new ArrayList<>();
        for (Object c : el.children) {
            if (c instanceof XmlParser.XmlText t) textParts.add(t.text);
            else if (c instanceof XmlParser.XmlElement e) elChildren.add(e);
        }
        if (elChildren.isEmpty()) return String.join("", textParts).trim();
        Map<String, List<Object>> grouped = new LinkedHashMap<>();
        for (XmlParser.XmlElement c : elChildren) {
            grouped.computeIfAbsent(c.tag, k -> new ArrayList<>()).add(elToJson(c));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, List<Object>> g : grouped.entrySet()) {
            List<Object> items = g.getValue();
            out.put(camel(g.getKey()), items.size() == 1 ? items.get(0) : items);
        }
        String text = String.join("", textParts).trim();
        if (!text.isEmpty()) out.put("#text", text);
        return out;
    }

    /* ---------- 執行模擬：依 profile 產出兩側回應 + diff ---------- */

    /** profile → 微服務系統側的覆蓋（路徑式；'Account.X' 指 Body.Account.X） */
    private static final class ProfileSpec {
        final Map<String, String> overrides;
        final List<String> drop;

        ProfileSpec(Map<String, String> overrides, List<String> drop) {
            this.overrides = overrides;
            this.drop = drop;
        }
    }

    private static final Map<String, ProfileSpec> NEW_PROFILE = new LinkedHashMap<>();
    static {
        NEW_PROFILE.put("pass", new ProfileSpec(Map.of(), List.of()));
        NEW_PROFILE.put("diff-time", new ProfileSpec(Map.of("TxnTime", "2026-08-26T01:30:00.000Z"), List.of()));
        NEW_PROFILE.put("diff-amount", new ProfileSpec(Map.of("Account.Balance", "9999.00"), List.of()));
        NEW_PROFILE.put("diff-renamed", new ProfileSpec(Map.of("Account.CustomerName", "陳大文"), List.of("Account.AcctName")));
        NEW_PROFILE.put("diff-array-len", new ProfileSpec(Map.of("Account.Transactions", "SLICE_2"), List.of()));
        NEW_PROFILE.put("diff-added-field", new ProfileSpec(Map.of("Account.RiskLevel", "LOW"), List.of()));
        NEW_PROFILE.put("diff-missing-field", new ProfileSpec(Map.of(), List.of("Account.Status")));
        NEW_PROFILE.put("diff-precision", new ProfileSpec(Map.of("Account.Balance", "12345.669999"), List.of()));
        NEW_PROFILE.put("diff-longnum", new ProfileSpec(Map.of("Account.AcctNo", "123456789012345679"), List.of()));
    }

    private static final String[] NAMES = {"陳大文", "李小明", "黃雅婷", "何俊傑", "吳美玲"};

    /** 基礎回應資料（依交易碼雜湊微調，避免所有案例完全一樣） */
    private Map<String, Object> baseResponse(Case c) {
        Rng r = new Rng(hash(c.getTxnCode()));
        String balance = fmt2(r.next() * 90000 + 1000);
        String name = NAMES[(int) (hash(c.getTxnCode()) % 5)];
        List<Map<String, String>> txns = new ArrayList<>();
        txns.add(txn(1, fmt2(r.next() * 2000 + 100), "20260824"));
        txns.add(txn(2, fmt2(r.next() * 3000 + 100), "20260825"));
        txns.add(txn(3, fmt2(r.next() * 4000 + 100), "20260826"));

        Map<String, Object> account = new LinkedHashMap<>();
        account.put("AcctNo", "123456789012345678");
        account.put("AcctName", name);
        account.put("Balance", balance);
        account.put("Currency", "HKD");
        account.put("Status", "A");
        account.put("AvailableBalance", balance);
        account.put("Transactions", txns);

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("TxnCode", c.getTxnCode());
        root.put("TxnTime", "2026-08-26T09:30:00.000+08:00");
        root.put("RespCode", "0000");
        root.put("RespMsg", "成功");
        root.put("Account", account);
        return root;
    }

    private static Map<String, String> txn(int seq, String amount, String date) {
        Map<String, String> t = new LinkedHashMap<>();
        t.put("Seq", String.valueOf(seq));
        t.put("Amount", amount);
        t.put("Date", date);
        return t;
    }

    public String buildHostResponse(Case c) {
        return renderHost(baseResponse(c));
    }

    @SuppressWarnings("unchecked")
    public String buildNewResponse(Case c) {
        Map<String, Object> merged = baseResponse(c);
        ProfileSpec spec = NEW_PROFILE.getOrDefault(c.getProfile(), NEW_PROFILE.get("pass"));
        for (Map.Entry<String, String> e : spec.overrides.entrySet()) {
            if ("SLICE_2".equals(e.getValue())) {
                Map<String, Object> account = (Map<String, Object>) merged.get("Account");
                List<Object> txns = (List<Object>) account.get("Transactions");
                account.put("Transactions", new ArrayList<>(txns.subList(0, 2)));
            } else {
                setPath(merged, e.getKey(), e.getValue());
            }
        }
        for (String p : spec.drop) delPath(merged, p);
        return renderNew(merged);
    }

    @SuppressWarnings("unchecked")
    private static void setPath(Map<String, Object> obj, String path, String val) {
        String[] parts = path.split("\\.");
        Map<String, Object> cur = obj;
        for (int i = 0; i < parts.length - 1; i++) cur = (Map<String, Object>) cur.get(parts[i]);
        cur.put(parts[parts.length - 1], val);
    }

    @SuppressWarnings("unchecked")
    private static void delPath(Map<String, Object> obj, String path) {
        String[] parts = path.split("\\.");
        Map<String, Object> cur = obj;
        for (int i = 0; i < parts.length - 1; i++) cur = (Map<String, Object>) cur.get(parts[i]);
        cur.remove(parts[parts.length - 1]);
    }

    /** 主機側 XML 渲染（對齊 renderHost 的精確結構） */
    private String renderHost(Map<String, Object> m) {
        String txnCode = (String) m.get("TxnCode");
        String txnTime = (String) m.get("TxnTime");
        String respCode = (String) m.get("RespCode");
        String respMsg = (String) m.get("RespMsg");
        @SuppressWarnings("unchecked")
        Map<String, Object> account = (Map<String, Object>) m.get("Account");
        @SuppressWarnings("unchecked")
        List<Map<String, String>> txns = (List<Map<String, String>>) account.get("Transactions");

        StringBuilder txnsLines = new StringBuilder();
        if (txns != null) {
            for (Map<String, String> t : txns) {
                txnsLines.append("      <Transaction><Seq>").append(t.get("Seq"))
                        .append("</Seq><Amount>").append(t.get("Amount"))
                        .append("</Amount><Date>").append(t.get("Date"))
                        .append("</Date></Transaction>\n");
            }
            if (txnsLines.length() > 0) txnsLines.setLength(txnsLines.length() - 1);
        }
        String acctName = account.get("AcctName") != null ? "\n      <AcctName>" + account.get("AcctName") + "</AcctName>" : "";
        String status = account.get("Status") != null ? "\n      <Status>" + account.get("Status") + "</Status>" : "";
        String txnsBlock = txns != null ? "\n      <Transactions>\n" + txnsLines + "\n      </Transactions>" : "";

        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<AccountInquiryResponse xmlns=\"urn:boc:host:acct\">\n"
                + "  <Header>\n"
                + "    <TxnCode>" + txnCode + "</TxnCode>\n"
                + "    <TxnTime>" + txnTime + "</TxnTime>\n"
                + "    <RespCode>" + respCode + "</RespCode>\n"
                + "    <RespMsg>" + respMsg + "</RespMsg>\n"
                + "  </Header>\n"
                + "  <Body>\n"
                + "    <Account>\n"
                + "      <AcctNo>" + account.get("AcctNo") + "</AcctNo>" + acctName + "\n"
                + "      <Balance>" + account.get("Balance") + "</Balance>\n"
                + "      <Currency>" + account.get("Currency") + "</Currency>" + status + "\n"
                + "      <AvailableBalance>" + account.get("AvailableBalance") + "</AvailableBalance>" + txnsBlock + "\n"
                + "    </Account>\n"
                + "  </Body>\n"
                + "</AccountInquiryResponse>";
    }

    /** 微服務系統側 JSON 渲染（Header/Body 信封，與 renderNew 一致） */
    private String renderNew(Map<String, Object> m) {
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("TxnCode", m.get("TxnCode"));
        header.put("TxnTime", m.get("TxnTime"));
        header.put("RespCode", m.get("RespCode"));
        header.put("RespMsg", m.get("RespMsg"));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("Account", m.get("Account"));
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("Header", header);
        root.put("Body", body);
        return prettyJson(root);
    }

    /* ---------- 案例執行 ---------- */

    /**
     * 執行單條案例 → 完整 Run（RNG 呼叫順序與 JS 版完全一致，保證輸出可重現）。
     *
     * @param c   案例
     * @param ctx 執行上下文
     */
    public Run runCase(Case c, RunContext ctx) {
        String startedAt = ctx.at != null ? ctx.at : TimeUtil.now();
        Rng hRng = new Rng(hash(c.getId() + "h" + ctx.runIndex));
        Rng nRng = new Rng(hash(c.getId() + "n" + ctx.runIndex));
        boolean httpMode = "http".equals(c.getMode());

        Run run = new Run();
        run.setId(seq.nextId(SeqService.PREFIX_RUN));
        run.setCaseId(c.getId());
        run.setBatchId(ctx.batchId);
        run.setType(ctx.type);
        // 對齊 JS `version || null`：空字串 → null
        run.setVersion(ctx.version == null || ctx.version.isEmpty() ? null : ctx.version);
        run.setCaseType(c.getType() == null || c.getType().isEmpty() ? "Regular" : c.getType());
        run.setTestType(c.getTestType() == null || c.getTestType().isEmpty() ? "SIT" : c.getTestType());
        run.setRunBy(ctx.runBy);
        run.setStartedAt(startedAt);
        run.setStateNote(c.getPrecondition() == null || c.getPrecondition().isEmpty() ? null : c.getPrecondition());

        Run.InputSnapshot snapshot = new Run.InputSnapshot();
        snapshot.setHostXml(c.getHostInput() != null && c.getHostInput().getRawXml() != null ? c.getHostInput().getRawXml() : "");
        snapshot.setNewInput(c.getNewInput());
        run.setInputSnapshot(snapshot);

        if (httpMode) {
            boolean fail = "http-fail".equals(c.getProfile());
            int httpStatus = fail ? 500 : 200;
            String rawBody = fail ? "{\"code\":5000,\"message\":\"內部服務器錯誤\"}" : buildNewResponse(c);
            int latency = 60 + (int) Math.floor(nRng.next() * 150);
            String verdict = httpStatus >= 200 && httpStatus < 300 ? "PASS" : "FAIL";

            List<Run.Step> steps = new ArrayList<>();
            steps.add(step("準備請求", "ok", 4 + (int) Math.floor(nRng.next() * 8),
                    (c.getNewInput() != null && c.getNewInput().getMethod() != null ? c.getNewInput().getMethod() : "POST")
                            + " " + (c.getNewInput() != null && c.getNewInput().getUrl() != null ? c.getNewInput().getUrl() : "")));
            steps.add(step("發送請求", "ok", latency, "HTTP " + httpStatus));
            steps.add(step("解析響應", "ok", 6 + (int) Math.floor(nRng.next() * 10), String.valueOf(rawBody.length()) + " 字元"));
            steps.add(step("判定", "PASS".equals(verdict) ? "ok" : "fail", 1,
                    "PASS".equals(verdict) ? "HTTP 2xx，執行成功" : "HTTP 非 2xx（" + httpStatus + "），執行失敗"));

            Run.HttpResult res = new Run.HttpResult();
            res.setHttpStatus(httpStatus);
            res.setLatencyMs(latency);
            res.setRawBody(rawBody);
            run.setNewResult(res);
            run.setVerdict(verdict);
            run.setSteps(steps);
            run.setFinishedAt(TimeUtil.fromMillis(TimeUtil.epochMillis(startedAt)
                    + 80 + latency + (int) Math.floor(nRng.next() * 300)));
            return run;
        }

        String hostBody = buildHostResponse(c);
        String newBody = buildNewResponse(c);
        int hostLatency = 80 + (int) Math.floor(hRng.next() * 200);
        int newLatency = 60 + (int) Math.floor(nRng.next() * 150);

        DiffResult diff = DiffEngine.compare(hostBody, newBody,
                ctx.config != null ? ctx.config.getDiffRules() : null, c.getStateType(),
                Map.of("stateNote", c.getPrecondition() == null ? "" : c.getPrecondition(),
                        "caseName", c.getName(), "txnCode", c.getTxnCode()));

        List<Run.Step> steps = new ArrayList<>();
        steps.add(step("準備請求", "ok", 4 + (int) Math.floor(hRng.next() * 8),
                "主機報文 " + String.valueOf(c.getHostInput() != null && c.getHostInput().getRawXml() != null
                        ? c.getHostInput().getRawXml() : "").length() + " 字元"));
        steps.add(step("發送主機請求", "ok", hostLatency, "HTTP 200"));
        steps.add(step("解析主機響應", "ok", 6 + (int) Math.floor(hRng.next() * 10), String.valueOf(hostBody.length()) + " 字元"));
        steps.add(step("發送微服務系統請求", "ok", newLatency,
                "HTTP 200 · " + (c.getNewInput() != null && c.getNewInput().getUrl() != null ? c.getNewInput().getUrl() : "")));
        steps.add(step("解析微服務系統響應", "ok", 6 + (int) Math.floor(nRng.next() * 10), String.valueOf(newBody.length()) + " 字元"));
        steps.add(step("字段比對", "ok", 3 + (int) Math.floor(nRng.next() * 12), "發現 " + diff.getItems().size() + " 處差異"));
        steps.add(step("判定", "PASS".equals(diff.getVerdict()) ? "ok" : "warn", 1,
                "PASS".equals(diff.getVerdict()) ? "兩側輸出一致，通過"
                        : "DIFF".equals(diff.getVerdict()) ? "存在差異，需人工評估" : "存在高可疑差異，判定失敗"));

        Run.HttpResult hostRes = new Run.HttpResult();
        hostRes.setHttpStatus(200);
        hostRes.setLatencyMs(hostLatency);
        hostRes.setRawBody(hostBody);
        Run.HttpResult newRes = new Run.HttpResult();
        newRes.setHttpStatus(200);
        newRes.setLatencyMs(newLatency);
        newRes.setRawBody(newBody);

        run.setHostResult(hostRes);
        run.setNewResult(newRes);
        run.setDiff(diff);
        run.setVerdict(diff.getVerdict());
        run.setSteps(steps);
        run.setFinishedAt(TimeUtil.fromMillis(TimeUtil.epochMillis(startedAt)
                + 200 + (int) Math.floor(hRng.next() * 800)));
        return run;
    }

    private static Run.Step step(String name, String status, int ms, String detail) {
        Run.Step s = new Run.Step();
        s.setName(name);
        s.setStatus(status);
        s.setMs(ms);
        s.setDetail(detail);
        return s;
    }

    /** 執行上下文（對齊 runCase 的具名參數） */
    @lombok.Builder
    @lombok.Data
    public static class RunContext {
        private Config config;
        private String type;
        private String batchId;
        private String runBy;
        private int runIndex;
        private String at;
        private String version;
    }

    /* ---------- 壓測曲線 ---------- */

    /** 對齊 buildStressRun：每秒採樣（ramp-up → 峰值 → 波動），RNG 順序逐位一致 */
    public StressRun buildStressRun(StressPlan plan, String at) {
        Rng r = new Rng(hash(plan.getId() + (plan.getRunCount() == null ? 0 : plan.getRunCount())));
        int peakTps = Math.max(10, (int) Math.round(plan.getConcurrency() * 8));
        int ramp = Math.min(plan.getRampUpSec() == null ? 10 : plan.getRampUpSec(), plan.getDurationSec());
        List<StressRun.Point> series = new ArrayList<>();
        long total = 0;
        for (int t = 1; t <= plan.getDurationSec(); t++) {
            double load = Math.min(1, (double) t / ramp) * (0.85 + 0.15 * Math.sin(t / 3.0));
            int tps = Math.max(0, (int) Math.round(peakTps * load * (0.9 + r.next() * 0.2)));
            int latencyP50 = (int) Math.round(80 + load * plan.getConcurrency() * 3 + r.next() * 40);
            double errorRate = Math.min(8, load > 0.9 ? 2.5 + r.next() * 2 : 0.3 + r.next() * 0.8);
            total += tps;
            StressRun.Point p = new StressRun.Point();
            p.setTSec(t);
            p.setTps(tps);
            p.setErrorRate(Math.round(errorRate * 100.0) / 100.0);
            p.setLatencyP50(latencyP50);
            series.add(p);
        }
        List<Integer> latArr = new ArrayList<>();
        for (StressRun.Point p : series) latArr.add(p.getLatencyP50());

        StressRun.Summary summary = new StressRun.Summary();
        summary.setTps((int) Math.round((double) total / Math.max(1, series.size())));
        long latSum = 0;
        for (int v : latArr) latSum += v;
        summary.setAvgLatencyMs((int) Math.round((double) latSum / latArr.size()));
        summary.setP50(pct(latArr, 50));
        summary.setP90(pct(latArr, 90));
        summary.setP95(pct(latArr, 95));
        summary.setP99(pct(latArr, 99));
        double errSum = 0;
        for (StressRun.Point p : series) errSum += p.getErrorRate();
        summary.setErrorRate(Math.round((errSum / series.size()) * 100.0) / 100.0);
        summary.setTotalRequests((int) total);

        StressRun run = new StressRun();
        run.setId(seq.nextId(SeqService.PREFIX_SR));
        run.setPlanId(plan.getId());
        run.setStatus("done");
        run.setStartedAt(at);
        run.setFinishedAt(TimeUtil.fromMillis(TimeUtil.epochMillis(at) + plan.getDurationSec() * 1000L + 500));
        run.setSummary(summary);
        run.setSeries(series);
        return run;
    }

    private static int pct(List<Integer> arr, int p) {
        List<Integer> s = new ArrayList<>(arr);
        s.sort(Integer::compareTo);
        int idx = Math.min(s.size() - 1, (int) Math.floor((s.size() * p) / 100.0));
        return s.get(idx);
    }

    /* ---------- JSON ---------- */

    private static final ObjectMapper PRETTY = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .setDateFormat(new StdDateFormat());

    /** JSON.stringify(obj, null, 2) 等效輸出（2 空格縮排） */
    static String prettyJson(Object o) {
        try {
            return PRETTY.writerWithDefaultPrettyPrinter().writeValueAsString(o);
        } catch (JsonProcessingException e) {
            throw new BizException(5000, "JSON 序列化失敗：" + e.getMessage());
        }
    }
}
