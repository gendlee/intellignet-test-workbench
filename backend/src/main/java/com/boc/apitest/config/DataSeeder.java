package com.boc.apitest.config;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boc.apitest.common.TimeUtil;
import com.boc.apitest.diff.Comparators.DiffRules;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Case.AiMeta;
import com.boc.apitest.entity.Case.HeaderDef;
import com.boc.apitest.entity.Case.HostInput;
import com.boc.apitest.entity.Case.NewInput;
import com.boc.apitest.entity.Case.Review;
import com.boc.apitest.entity.Misc.AuditLog;
import com.boc.apitest.entity.Misc.CaseType;
import com.boc.apitest.entity.Misc.Config;
import com.boc.apitest.entity.Misc.Config.Env;
import com.boc.apitest.entity.Misc.Config.UrlTemplateSeg;
import com.boc.apitest.entity.Misc.Module;
import com.boc.apitest.entity.Misc.SystemRec;
import com.boc.apitest.entity.Misc.Version;
import com.boc.apitest.entity.Run;
import com.boc.apitest.entity.StressPlan;
import com.boc.apitest.entity.StressRun;
import com.boc.apitest.mapper.Mappers.AuditLogMapper;
import com.boc.apitest.mapper.Mappers.CaseMapper;
import com.boc.apitest.mapper.Mappers.CaseTypeMapper;
import com.boc.apitest.mapper.Mappers.ConfigMapper;
import com.boc.apitest.mapper.Mappers.MetaMapper;
import com.boc.apitest.mapper.Mappers.ModuleMapper;
import com.boc.apitest.mapper.Mappers.RunMapper;
import com.boc.apitest.mapper.Mappers.StressPlanMapper;
import com.boc.apitest.mapper.Mappers.StressRunMapper;
import com.boc.apitest.mapper.Mappers.SystemRecMapper;
import com.boc.apitest.mapper.Mappers.VersionMapper;
import com.boc.apitest.service.GeneratorService;
import com.boc.apitest.service.GeneratorService.RunContext;
import com.boc.apitest.service.SeqService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 種子資料（mock/seed.js 逐項移植）：
 * 插入順序即 id 序號——versions V0001–V0072（36 個月 × A/Z，code 降序）
 * → modules M01–M05（顯式 id）→ caseTypes CT01–CT04（顯式 id）
 * → cases C0073–C0082 → 審核記錄 AL{C} → runs R0083–R0104（22 條）
 * → stressPlans SP0105–SP0107 → stressRuns SR0108（僅第一個計劃）。
 * 空庫才執行（H2 每次啟動全新；MySQL 重啟不重複）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataSeeder implements ApplicationRunner {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final VersionMapper versionMapper;
    private final ModuleMapper moduleMapper;
    private final CaseTypeMapper caseTypeMapper;
    private final CaseMapper caseMapper;
    private final RunMapper runMapper;
    private final AuditLogMapper auditLogMapper;
    private final StressPlanMapper stressPlanMapper;
    private final StressRunMapper stressRunMapper;
    private final SystemRecMapper systemRecMapper;
    private final ConfigMapper configMapper;
    private final MetaMapper metaMapper;
    private final SeqService seqService;
    private final GeneratorService generatorService;

    @Override
    public void run(ApplicationArguments args) throws Exception {
        Long existing = versionMapper.selectCount(null);
        if (existing != null && existing > 0) {
            log.info("已存在 {} 條版本數據，跳過種子初始化", existing);
            return;
        }
        log.info("開始初始化種子數據……");
        seedSystems();
        seedMeta();
        seedConfig();
        seedVersions();
        seedModules();
        seedCaseTypes();
        List<Case> cases = seedCases();
        seedAuditLogs(cases);
        seedRuns(cases);
        seedPlans();
        log.info("種子數據初始化完成");
    }

    /* ---------- 系統 / 元數據 / 配置 ---------- */

    private void seedSystems() {
        SystemRec[] recs = {
                rec("EBP-CL", "EBP-CL 企業銀行平台", true, false),
                rec("EBP-RTL", "EBP-RTL 零售銀行平台", false, true),
                rec("EBP-TRD", "EBP-TRD 交易平台", false, true),
        };
        for (SystemRec r : recs) systemRecMapper.insert(r);
    }

    private static SystemRec rec(String id, String name, boolean active, boolean readOnly) {
        SystemRec r = new SystemRec();
        r.setId(id);
        r.setName(name);
        r.setActive(active);
        r.setReadOnly(readOnly);
        return r;
    }

    private void seedMeta() throws Exception {
        com.boc.apitest.entity.Misc.Meta meta = new com.boc.apitest.entity.Misc.Meta();
        meta.setId("main");
        Map<String, Object> payload = new LinkedHashMap<>();
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("id", "u001");
        user.put("name", "測試工程師 陳");
        user.put("role", "tester");
        payload.put("currentUser", user);
        payload.put("currentSystem", "EBP-CL");
        Map<String, Object> features = new LinkedHashMap<>();
        features.put("aiGenerate", true);
        features.put("capture", false);
        features.put("stress", true);
        features.put("multiSystem", false);
        payload.put("features", features);
        meta.setPayload(MAPPER.writeValueAsString(payload));
        metaMapper.insert(meta);
    }

    private void seedConfig() {
        Config cfg = new Config();
        cfg.setId("main");
        cfg.setSystemId("EBP-CL");
        cfg.setReadOnly(false);
        cfg.setUrlTemplate(urlTemplate());
        cfg.setEnvironments(environments());
        cfg.setDefaultHeaders(defaultHeaders());
        cfg.setDiffRules(diffRules());
        Config.AiConfig ai = new Config.AiConfig();
        ai.setEnabled(true);
        ai.setMode("mock");
        ai.setApiBase("");
        ai.setModel("");
        ai.setApiKey("");
        cfg.setAi(ai);
        configMapper.insert(cfg);
    }

    private static List<UrlTemplateSeg> urlTemplate() {
        List<UrlTemplateSeg> list = new ArrayList<>();
        list.add(seg("fixed", "https://newapi.boc.com.hk"));
        list.add(seg("fixed", "ebp"));
        list.add(seg("var", "api"));
        list.add(seg("var", "v1"));
        return list;
    }

    private static UrlTemplateSeg seg(String kind, String value) {
        UrlTemplateSeg s = new UrlTemplateSeg();
        s.setKind(kind);
        s.setValue(value);
        return s;
    }

    private static List<Env> environments() {
        List<Env> list = new ArrayList<>();
        list.add(env("SIT1", "SIT1 系統集成測試", "https://sit1.newapi.boc.com.hk", true));
        list.add(env("SIT3", "SIT3 系統集成測試", "https://sit3.newapi.boc.com.hk", false));
        list.add(env("USMK", "USMK 市場測試", "https://usmk.newapi.boc.com.hk", false));
        list.add(env("USMF", "USMF 市場試運行", "https://usmf.newapi.boc.com.hk", false));
        return list;
    }

    private static Env env(String id, String name, String baseUrl, boolean current) {
        Env e = new Env();
        e.setId(id);
        e.setName(name);
        e.setBaseUrl(baseUrl);
        e.setCurrent(current);
        return e;
    }

    private static List<HeaderDef> defaultHeaders() {
        List<HeaderDef> list = new ArrayList<>();
        list.add(hdr("API-Key", "boc-ebp-2026-demo", true, true));
        list.add(hdr("Content-Type", "application/json", true, false));
        list.add(hdr("X-Client-Id", "EBP-CL", true, false));
        return list;
    }

    private static HeaderDef hdr(String name, String value, boolean enabled, boolean secret) {
        HeaderDef h = new HeaderDef();
        h.setName(name);
        h.setValue(value);
        h.setEnabled(enabled);
        h.setSecret(secret);
        return h;
    }

    private static DiffRules diffRules() {
        DiffRules r = new DiffRules();
        r.arrayMatchMode = "index";
        r.arrayMatchKeys = new LinkedHashMap<>();
        r.ignoreFields = new ArrayList<>(List.of("RespMsg"));
        r.dynamicRegex = new ArrayList<>(List.of(".*(tStamp|nonce|traceId|requestId)$"));
        r.numeric = "strict";
        r.numericTolerance = 1e-9;
        r.longNumberGuard = 15;
        r.timeNormalize = true;
        r.attrMerge = true;
        r.namespaceInsensitive = true;
        r.emptyEqualsNull = false;
        r.wrapIgnoreKeys = new ArrayList<>();
        r.collapseSingleArray = true;
        return r;
    }

    /* ---------- 版本號（36 個月 × A/Z） ---------- */

    private void seedVersions() {
        List<Version> versions = new ArrayList<>();
        java.time.YearMonth now = java.time.YearMonth.now();
        for (int i = 0; i < 36; i++) {
            // 同 JS new Date(y, m+i, 1)：跨年自動進位
            java.time.YearMonth ym = now.plusMonths(i);
            String key = String.format(Locale.ROOT, "%04d%02d", ym.getYear(), ym.getMonthValue());
            versions.add(ver(key + "A", key, "A", "集中版本", i));
            versions.add(ver(key + "Z", key, "Z", "非集中版本", i));
        }
        versions.sort((a, b) -> b.getCode().compareTo(a.getCode()));
        for (Version v : versions) versionMapper.insert(v);
    }

    private Version ver(String code, String month, String mode, String modeLabel, int i) {
        Version v = new Version();
        v.setId(seqService.nextId(SeqService.PREFIX_VERSION));
        v.setCode(code);
        v.setMonth(month);
        v.setMode(mode);
        v.setModeLabel(modeLabel);
        v.setCreatedAt(daysAgo(i % 7, 9 + (i % 4)));
        return v;
    }

    /* ---------- 業務模組 / 案例類型 ---------- */

    private void seedModules() {
        String[][] specs = {
                {"ACCT", "帳戶查詢", "帳戶餘額、基本資料與交易明細查詢"},
                {"PAYM", "轉賬", "行內/跨行轉賬與授權"},
                {"LOAN", "貸款查詢", "貸款餘額與明細查詢"},
                {"TXNL", "交易明細", "交易明細清單查詢"},
                {"MISC", "費率查詢", "銀行費率/匯率查詢"},
        };
        for (int i = 0; i < specs.length; i++) {
            Module m = new Module();
            m.setId(String.format(Locale.ROOT, "M%02d", i + 1));
            m.setCode(specs[i][0]);
            m.setName(specs[i][1]);
            m.setDescription(specs[i][2]);
            m.setCreatedAt(daysAgo(10, 9));
            moduleMapper.insert(m);
        }
    }

    private void seedCaseTypes() {
        String[][] specs = {
                {"Regular", "常規成功路徑與基本場景"},
                {"ECC", "異常/錯誤碼場景（Error Code & Condition）"},
                {"ExceptionHandling", "異常處理：超時、重試、併發等"},
                {"Boundaries", "邊界值：最大/最小/空值/超長等"},
        };
        for (int i = 0; i < specs.length; i++) {
            CaseType t = new CaseType();
            t.setId(String.format(Locale.ROOT, "CT%02d", i + 1));
            t.setName(specs[i][0]);
            t.setDescription(specs[i][1]);
            t.setCreatedAt(daysAgo(10, 8));
            caseTypeMapper.insert(t);
        }
    }

    /* ---------- 案例 ---------- */

    private List<Case> seedCases() {
        Config cfg = configMapper.selectById("main");
        List<Case> out = new ArrayList<>();
        for (CaseSpec s : CASE_SPECS) {
            String rawXml = s.req;
            NewInput ai = generatorService.aiGenerate(rawXml, cfg.getUrlTemplate(), cfg.getDefaultHeaders(), "");
            Case c = new Case();
            c.setId(seqService.nextId(SeqService.PREFIX_CASE));
            c.setTxnCode(s.txnCode);
            c.setName(s.name);
            c.setSystemId("EBP-CL");
            c.setModule(s.module);
            c.setStateType(s.stateType);
            c.setStatus(s.status);
            c.setPrecondition(s.precondition);
            c.setMode("compare");
            c.setHostFormat("XML");
            c.setProfile(s.profile);
            c.setType(s.type);
            c.setTestType(s.testType);
            c.setVersions(new ArrayList<>(s.versions));
            HostInput host = new HostInput();
            host.setRawXml(rawXml);
            c.setHostInput(host);
            ai.setRefinedByHuman(false);
            c.setNewInput(ai);
            AiMeta aiMeta = new AiMeta();
            aiMeta.setSource("ai");
            aiMeta.setGeneratedAt(daysAgo(9, 9));
            aiMeta.setRefinedByHuman(false);
            c.setAiMeta(aiMeta);
            c.setReview(s.review != null
                    ? review(s.review[0], s.review[1], Integer.parseInt(s.review[2]), Integer.parseInt(s.review[3]))
                    : null);
            c.setCreatedBy("測試工程師 陳");
            c.setCreatedAt(daysAgo(9, 9 + out.size()));
            c.setUpdatedAt(daysAgo(3, 9 + out.size()));
            caseMapper.insert(c);
            out.add(c);
        }
        return out;
    }

    private static Review review(String reviewer, String comment, int d, int h) {
        Review r = new Review();
        r.setReviewer(reviewer);
        r.setComment(comment);
        r.setAt(daysAgo(d, h));
        return r;
    }

    private void seedAuditLogs(List<Case> cases) {
        for (Case c : cases) {
            if (c.getReview() == null) continue;
            AuditLog l = new AuditLog();
            l.setId("AL" + c.getId());
            l.setCaseId(c.getId());
            l.setAction("APPROVED".equals(c.getStatus()) ? "approve" : "reject");
            l.setFromStatus("PENDING");
            l.setToStatus(c.getStatus());
            l.setOperator(c.getReview().getReviewer());
            l.setAt(c.getReview().getAt());
            l.setComment(c.getReview().getComment());
            auditLogMapper.insert(l);
        }
    }

    /* ---------- 預置運行（近 7 天） ---------- */

    private void seedRuns(List<Case> cases) {
        Config cfg = configMapper.selectById("main");
        for (Case c : cases) {
            int[] days = dayArray(c.getTxnCode());
            if (days == null) continue;
            for (int i = 0; i < days.length; i++) {
                String at = daysAgo(days[i], 10 + (i % 5));
                RunContext ctx = RunContext.builder()
                        .config(cfg)
                        .runBy("測試工程師 陳")
                        .runIndex(i + 1)
                        .at(at)
                        .build();
                Run run = generatorService.runCase(c, ctx);
                runMapper.insert(run);
            }
        }
        // lastRun 回填：db.runs 為 unshift（新在前），find 返回最先插入的運行（最舊）
        for (Case c : cases) {
            if ("APPROVED".equals(c.getStatus()) || "REJECTED".equals(c.getStatus())) {
                List<Run> runs = runMapper.selectList(new LambdaQueryWrapper<Run>().eq(Run::getCaseId, c.getId()));
                if (!runs.isEmpty()) {
                    runs.sort((a, b) -> a.getStartedAt().compareTo(b.getStartedAt()));
                    c.setLastRun(runs.get(0));
                    caseMapper.updateById(c);
                }
            }
        }
    }

    private static int[] dayArray(String txn) {
        switch (txn) {
            case "ACCT1001": return new int[]{6, 5, 4, 3, 2, 1, 0};
            case "ACCT1002": return new int[]{6, 4, 2};
            case "ACCT1003": return new int[]{5, 3, 1};
            case "ACCT1004": return new int[]{4, 2};
            case "ACCT1005": return new int[]{3, 1};
            case "PAYM2001": return new int[]{2};
            case "LOAN3001": return new int[]{5, 0};
            case "LOAN3002": return new int[]{4, 0};
            default: return null;
        }
    }

    /* ---------- 壓測計劃 ---------- */

    private void seedPlans() {
        StressPlan[] plans = new StressPlan[3];
        plans[0] = plan("帳戶查詢 — 日常峰值壓測", "POST", "https://newapi.boc.com.hk/ebp/api/v1/accountInquiry/ACCT1001",
                "{\"acctNo\":\"123456789012345678\",\"currency\":\"HKD\"}", 50, 60, 10,
                "approved", review("審核專員 李", "計劃合理，批准執行", 2, 13), daysAgo(2, 14));
        plans[1] = plan("轉賬接口 — 高併發驗證", "POST", "https://newapi.boc.com.hk/ebp/api/v1/transfer/PAYM2001",
                "{\"fromAcctNo\":\"...\",\"amount\":\"500.00\"}", 120, 120, 20,
                "pending", null, daysAgo(1, 16));
        plans[2] = plan("交易明細 — 穩定性測試", "POST", "https://newapi.boc.com.hk/ebp/api/v1/transactionList/ACCT1004",
                "{\"acctNo\":\"123456789012345678\",\"startDate\":\"20260801\"}", 30, 300, 30,
                "approved", review("審核專員 李", "批准執行", 3, 10), daysAgo(4, 11));

        for (int i = 0; i < plans.length; i++) {
            StressPlan p = plans[i];
            p.setId(seqService.nextId(SeqService.PREFIX_PLAN));
            stressPlanMapper.insert(p);
            if (i == 0) {
                p.setRunCount(1);
                StressRun run = generatorService.buildStressRun(p, daysAgo(2, 14));
                stressRunMapper.insert(run);
                p.setLastRun(run);
                p.setStatus("done");
                stressPlanMapper.updateById(p);
            }
        }
    }

    private StressPlan plan(String name, String method, String url, String body, int concurrency,
                            int durationSec, int rampUpSec, String status, Review review, String createdAt) {
        StressPlan p = new StressPlan();
        p.setName(name);
        p.setMethod(method);
        p.setUrl(url);
        p.setHeaders(defaultHeaders());
        p.setBody(body);
        p.setConcurrency(concurrency);
        p.setDurationSec(durationSec);
        p.setRampUpSec(rampUpSec);
        p.setStatus(status);
        p.setReview(review);
        p.setRunCount(0);
        p.setCreatedBy("測試工程師 陳");
        p.setCreatedAt(createdAt);
        return p;
    }

    /* ---------- 時間工具（本地時區 setHours 語義） ---------- */

    /** daysAgo(n, h)：n 天前本地時間 h:30:00 → ISO UTC */
    static String daysAgo(int n, int h) {
        return daysAgo(n, h, 30, 0);
    }

    static String daysAgo(int n, int h, int mi, int s) {
        LocalDateTime d = LocalDateTime.now()
                .minusDays(n)
                .withHour(h).withMinute(mi).withSecond(s).withNano(0);
        return TimeUtil.iso(d.atZone(ZoneId.systemDefault()).toInstant());
    }

    /* ---------- 案例定義 ---------- */

    private record CaseSpec(String txnCode, String name, String module, String req, String profile,
                            String stateType, String status, String precondition, String type, String testType,
                            List<String> versions, String[] review) {}

    /* 注意：REQ 必須在 CASE_SPECS 之前初始化（buildCaseSpecs 依賴它） */
    private static final Map<String, String> REQ = buildReqs();

    private static final List<CaseSpec> CASE_SPECS = buildCaseSpecs();

    private static List<CaseSpec> buildCaseSpecs() {
        List<CaseSpec> list = new ArrayList<>();
        list.add(spec("ACCT1001", "帳戶查詢 — 基本成功", "帳戶查詢", "account",
                "pass", "STATELESS", "APPROVED", null, "Regular", "SIT",
                List.of("202611A", "202612A"), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("ACCT1002", "帳戶查詢 — 時間格式差異", "帳戶查詢", "account",
                "diff-time", "STATELESS", "APPROVED", null, "Regular", "SIT",
                List.of("202611A"), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("ACCT1003", "帳戶查詢 — 餘額不一致", "帳戶查詢", "account",
                "diff-amount", "STATELESS", "APPROVED", null, "Boundaries", "SIT",
                List.of("202611Z"), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("ACCT1004", "交易明細查詢 — 字段重命名", "交易明細", "txn",
                "diff-renamed", "STATEFUL", "APPROVED", "需先執行開戶 ACCT0001 並產生至少 1 筆交易", "Regular", "SIT",
                List.of("202611A"), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("ACCT1005", "交易明細查詢 — 數組長度差異", "交易明細", "txn",
                "diff-array-len", "STATELESS", "APPROVED", null, "Boundaries", "UAT",
                List.of("202611Z"), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("PAYM2001", "轉賬 — 微服務系統新增字段", "轉賬", "pay",
                "diff-added-field", "STATEFUL", "APPROVED", "需先完成轉賬授權簽核", "ECC", "UAT",
                List.of("202611A"), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("PAYM2002", "轉賬 — 微服務系統缺少字段", "轉賬", "pay",
                "diff-missing-field", "STATEFUL", "PENDING", "需先完成轉賬授權簽核", "ExceptionHandling", "UAT",
                List.of(), null));
        list.add(spec("LOAN3001", "貸款餘額查詢 — 精度差異", "貸款查詢", "loan",
                "diff-precision", "STATELESS", "APPROVED", null, "Boundaries", "SIT",
                List.of(), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("LOAN3002", "貸款明細 — 長數字精度風險", "貸款查詢", "loan",
                "diff-longnum", "STATELESS", "APPROVED", null, "ExceptionHandling", "SIT",
                List.of(), new String[]{"審核專員 李", "審核通過，案例有效", "8", "11"}));
        list.add(spec("MISC9001", "查詢費率 — 已駁回", "費率查詢", "loan",
                "pass", "STATELESS", "REJECTED", null, "ExceptionHandling", "UAT",
                List.of(), new String[]{"審核專員 李", "報文缺少必填字段，請補充後重新提交", "2", "15"}));
        return list;
    }

    private static CaseSpec spec(String txnCode, String name, String module, String reqKey,
                                 String profile, String stateType, String status, String precondition,
                                 String type, String testType, List<String> versions, String[] review) {
        return new CaseSpec(txnCode, name, module, REQ.get(reqKey).replace("__TXN__", txnCode),
                profile, stateType, status, precondition == null ? "" : precondition, type, testType, versions, review);
    }

    private static Map<String, String> buildReqs() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("account", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<AccountInquiryRequest>\n"
                + "  <Header>\n"
                + "    <TxnCode>__TXN__</TxnCode>\n"
                + "    <Channel>EBI</Channel>\n"
                + "    <UserId>TEST01</UserId>\n"
                + "    <TxnTime>2026-08-20T10:00:00.000+08:00</TxnTime>\n"
                + "  </Header>\n"
                + "  <Body>\n"
                + "    <AcctNo>123456789012345678</AcctNo>\n"
                + "    <Currency>HKD</Currency>\n"
                + "  </Body>\n"
                + "</AccountInquiryRequest>");
        m.put("txn", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<TransactionListRequest>\n"
                + "  <Header>\n"
                + "    <TxnCode>__TXN__</TxnCode>\n"
                + "    <Channel>EBI</Channel>\n"
                + "    <UserId>TEST01</UserId>\n"
                + "  </Header>\n"
                + "  <Body>\n"
                + "    <AcctNo>123456789012345678</AcctNo>\n"
                + "    <StartDate>20260801</StartDate>\n"
                + "    <EndDate>20260826</EndDate>\n"
                + "  </Body>\n"
                + "</TransactionListRequest>");
        m.put("pay", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<TransferRequest>\n"
                + "  <Header>\n"
                + "    <TxnCode>__TXN__</TxnCode>\n"
                + "    <Channel>EBI</Channel>\n"
                + "    <UserId>TEST01</UserId>\n"
                + "  </Header>\n"
                + "  <Body>\n"
                + "    <FromAcctNo>123456789012345678</FromAcctNo>\n"
                + "    <ToAcctNo>876543210987654321</ToAcctNo>\n"
                + "    <Amount>500.00</Amount>\n"
                + "    <Currency>HKD</Currency>\n"
                + "  </Body>\n"
                + "</TransferRequest>");
        m.put("loan", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<LoanBalanceRequest>\n"
                + "  <Header>\n"
                + "    <TxnCode>__TXN__</TxnCode>\n"
                + "    <Channel>EBI</Channel>\n"
                + "    <UserId>TEST01</UserId>\n"
                + "  </Header>\n"
                + "  <Body>\n"
                + "    <LoanNo>LN2026000012</LoanNo>\n"
                + "  </Body>\n"
                + "</LoanBalanceRequest>");
        return m;
    }

    static String reqFor(String reqKey, String txnCode) {
        return REQ.get(reqKey).replace("__TXN__", txnCode);
    }
}
