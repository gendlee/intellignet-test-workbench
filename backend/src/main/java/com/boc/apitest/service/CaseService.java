package com.boc.apitest.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boc.apitest.common.BizException;
import com.boc.apitest.common.PageResult;
import com.boc.apitest.common.TimeUtil;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Case.AiMeta;
import com.boc.apitest.entity.Case.HostInput;
import com.boc.apitest.entity.Case.NewInput;
import com.boc.apitest.entity.Case.Review;
import com.boc.apitest.entity.Misc.AuditLog;
import com.boc.apitest.entity.Misc.CaseType;
import com.boc.apitest.entity.Misc.Config;
import com.boc.apitest.entity.Misc.Version;
import com.boc.apitest.entity.Run;
import com.boc.apitest.mapper.Mappers.AuditLogMapper;
import com.boc.apitest.mapper.Mappers.CaseMapper;
import com.boc.apitest.mapper.Mappers.CaseTypeMapper;
import com.boc.apitest.mapper.Mappers.RunMapper;
import com.boc.apitest.mapper.Mappers.VersionMapper;
import com.boc.apitest.service.GeneratorService.RunContext;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 案例中心（mock/routes.js 移植）：
 * 列表篩選（txnCode/keyword/status/module/version 執行∪關聯）、CRUD（交易碼可維護、
 * 唯一標識為案例編號）、批量關聯版本（幂等）、審核、AI 生成、執行（版本可選）、
 * 運行歷史分頁、審計日誌。
 */
@Service
@RequiredArgsConstructor
public class CaseService {

    private final CaseMapper caseMapper;
    private final RunMapper runMapper;
    private final AuditLogMapper auditLogMapper;
    private final VersionMapper versionMapper;
    private final CaseTypeMapper caseTypeMapper;
    private final SeqService seqService;
    private final MetaService metaService;
    private final ConfigService configService;
    private final GeneratorService generatorService;

    /* ---------- 版本解析：code 或 id → code；不存在返回 null ---------- */

    public String resolveVersion(Object v) {
        if (v == null) return null;
        if (v instanceof JsonNode j) {
            if (j.isObject()) return j.hasNonNull("code") ? j.get("code").asText() : null;
            v = j.asText();
        }
        String s = String.valueOf(v);
        Version found = versionMapper.selectList(new LambdaQueryWrapper<Version>()
                .eq(Version::getCode, s).or().eq(Version::getId, s)).stream().findFirst().orElse(null);
        return found == null ? null : found.getCode();
    }

    /* ---------- 列表 ---------- */

    public PageResult<Case> listCases(String txnCode, String keyword, String status, String module,
                                      String version, Integer page, Integer pageSize) {
        List<Case> list = new ArrayList<>();
        for (Case c : caseMapper.selectList(null)) {
            if (txnCode != null && !txnCode.isEmpty() && !c.getTxnCode().contains(txnCode)) continue;
            if (keyword != null && !keyword.isEmpty()) {
                String up = keyword.toUpperCase(Locale.ROOT);
                boolean hit = c.getName() != null && c.getName().contains(keyword)
                        || c.getTxnCode() != null && c.getTxnCode().contains(keyword)
                        || c.getId() != null && c.getId().contains(up);
                if (!hit) continue;
            }
            if (status != null && !status.isEmpty() && !status.equals(c.getStatus())) continue;
            if (module != null && !module.isEmpty() && !module.equals(c.getModule())) continue;
            if (version != null && !version.isEmpty()) {
                // 版本篩選：執行過 ∪ 顯式關聯
                Set<String> executed = new HashSet<>();
                for (Run r : runMapper.selectList(new LambdaQueryWrapper<Run>().eq(Run::getVersion, version))) {
                    executed.add(r.getCaseId());
                }
                boolean linked = c.getVersions() != null && c.getVersions().contains(version);
                if (!executed.contains(c.getId()) && !linked) continue;
            }
            list.add(c);
        }
        list.sort((a, b) -> a.getTxnCode().compareTo(b.getTxnCode()));
        return PageResult.paginate(list, page == null ? null : String.valueOf(page), pageSize == null ? null : String.valueOf(pageSize));
    }

    /* ---------- 詳情（含審計日誌） ---------- */

    public Case getCase(String id) {
        Case c = caseMapper.selectById(id);
        if (c == null) throw new BizException(4040, "案例不存在");
        List<AuditLog> logs = auditLogMapper.selectList(new LambdaQueryWrapper<AuditLog>().eq(AuditLog::getCaseId, id));
        c.setAuditLogs(logs);
        return c;
    }

    /* ---------- 建立 ---------- */

    public Case createCase(JsonNode body) {
        String txnCode = text(body, "txnCode");
        String name = text(body, "name");
        if (isEmpty(txnCode) || isEmpty(name)) throw new BizException(4000, "交易碼與案例名稱必填");
        String type = text(body, "type");
        if (type != null && !type.isEmpty()) ensureCaseType(type);
        String testType = text(body, "testType");
        if (testType != null && !"SIT".equals(testType) && !"UAT".equals(testType)) {
            throw new BizException(4000, "測試類型須為 SIT 或 UAT");
        }
        String hostFormat = "JSON".equals(text(body, "hostFormat")) ? "JSON" : "XML";
        String mode = "http".equals(text(body, "mode")) ? "http" : "compare";
        JsonNode hi = body.get("hostInput");
        String rawXml = hi != null && hi.hasNonNull("rawXml") ? hi.get("rawXml").asText() : "";

        Case c = new Case();
        c.setId(seqService.nextId(SeqService.PREFIX_CASE));
        c.setTxnCode(txnCode);
        c.setName(name);
        c.setSystemId(metaService.currentSystem());
        String module = text(body, "module");
        c.setModule(isEmpty(module) ? "未分類" : module);
        c.setStateType("STATEFUL".equals(text(body, "stateType")) ? "STATEFUL" : "STATELESS");
        c.setType(isEmpty(type) ? "Regular" : type);
        c.setTestType(isEmpty(testType) ? "SIT" : testType);
        c.setStatus("PENDING");
        c.setPrecondition(body.hasNonNull("precondition") ? body.get("precondition").asText() : "");
        c.setMode(mode);
        c.setHostFormat(hostFormat);
        c.setProfile("pass");
        HostInput host = new HostInput();
        host.setRawXml(rawXml);
        c.setHostInput(host);
        JsonNode ni = body.get("newInput");
        if (ni != null && !ni.isNull()) c.setNewInput(fromJson(ni));
        AiMeta ai = new AiMeta();
        ai.setSource(ni != null && !ni.isNull() ? "ai" : "manual");
        ai.setGeneratedAt(TimeUtil.now());
        ai.setRefinedByHuman(false);
        c.setAiMeta(ai);
        c.setReview(null);
        c.setCreatedBy(metaService.currentUser().getName());
        c.setCreatedAt(TimeUtil.now());
        c.setUpdatedAt(TimeUtil.now());
        caseMapper.insert(c);

        AuditLog log = new AuditLog();
        log.setId("AL" + c.getId());
        log.setCaseId(c.getId());
        log.setAction("create");
        log.setFromStatus("-");
        log.setToStatus("PENDING");
        log.setOperator(c.getCreatedBy());
        log.setAt(TimeUtil.now());
        log.setComment("建立案例，待審核");
        auditLogMapper.insert(log);
        return c;
    }

    /* ---------- 更新（部分合併；報文/模式/格式變更 → 重新待審核） ---------- */

    public Case updateCase(String id, JsonNode body) {
        Case c = caseMapper.selectById(id);
        if (c == null) throw new BizException(4040, "案例不存在");
        boolean contentChanged = false;
        if (body.hasNonNull("txnCode")) c.setTxnCode(body.get("txnCode").asText());
        if (body.hasNonNull("name")) c.setName(body.get("name").asText());
        if (body.hasNonNull("module")) c.setModule(body.get("module").asText());
        if (body.hasNonNull("stateType")) c.setStateType("STATEFUL".equals(body.get("stateType").asText()) ? "STATEFUL" : "STATELESS");
        if (body.hasNonNull("mode")) {
            c.setMode("http".equals(body.get("mode").asText()) ? "http" : "compare");
            contentChanged = true;
        }
        if (body.hasNonNull("hostFormat")) {
            c.setHostFormat("JSON".equals(body.get("hostFormat").asText()) ? "JSON" : "XML");
            contentChanged = true;
        }
        if (body.hasNonNull("type")) {
            String type = body.get("type").asText();
            ensureCaseType(type);
            c.setType(type);
        }
        if (body.hasNonNull("testType")) c.setTestType(body.get("testType").asText());
        if (body.hasNonNull("hostInput")) {
            JsonNode hi = body.get("hostInput");
            HostInput host = new HostInput();
            host.setRawXml(hi.hasNonNull("rawXml") ? hi.get("rawXml").asText() : "");
            c.setHostInput(host);
            contentChanged = true;
        }
        if (body.hasNonNull("newInput")) {
            JsonNode ni = body.get("newInput");
            NewInput n = fromJson(ni);
            n.setRefinedByHuman(true);
            c.setNewInput(n);
            contentChanged = true;
        }
        if (body.has("precondition")) {
            JsonNode p = body.get("precondition");
            c.setPrecondition(p.isNull() ? "" : p.asText());
        }
        if (contentChanged) {
            AiMeta ai = new AiMeta();
            ai.setSource("ai");
            ai.setGeneratedAt(c.getAiMeta() != null ? c.getAiMeta().getGeneratedAt() : null);
            ai.setRefinedByHuman(true);
            c.setAiMeta(ai);
            c.setUpdatedAt(TimeUtil.now());
            // 已審核案例回到待審核，清掉舊審核意見
            if ("APPROVED".equals(c.getStatus()) || "REJECTED".equals(c.getStatus())) {
                c.setStatus("PENDING");
                c.setReview(null);
            }
        }
        caseMapper.updateById(c);
        return c;
    }

    /* ---------- 刪除 ---------- */

    public Case deleteCase(String id) {
        Case c = caseMapper.selectById(id);
        if (c == null) throw new BizException(4040, "案例不存在");
        long runs = runMapper.selectCount(new LambdaQueryWrapper<Run>().eq(Run::getCaseId, id));
        if ("APPROVED".equals(c.getStatus()) && runs > 0) {
            throw new BizException(4000, "該案例已有執行記錄，建議停用而非刪除；如需刪除請先聯絡管理員");
        }
        caseMapper.deleteById(id);
        return c;
    }

    /* ---------- 批量關聯版本（幂等） ---------- */

    public Map<String, Object> batchLink(List<String> caseIds, Object versionRaw) {
        String version = resolveVersion(versionRaw);
        if (version == null) {
            String raw = versionRaw instanceof JsonNode j ? j.asText() : String.valueOf(versionRaw == null ? "" : versionRaw);
            throw new BizException(4000, "版本號 " + raw + " 不存在，請先到案例中心維護");
        }
        if (caseIds == null || caseIds.isEmpty()) throw new BizException(4000, "請先勾選案例");
        int linked = 0;
        int skipped = 0;
        for (String id : caseIds) {
            Case c = caseMapper.selectById(id);
            if (c == null) continue;
            List<String> arr = c.getVersions() != null ? new ArrayList<>(c.getVersions()) : new ArrayList<>();
            if (arr.contains(version)) {
                skipped++;
                continue;
            }
            arr.add(version);
            c.setVersions(arr);
            caseMapper.updateById(c);
            linked++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("linked", linked);
        out.put("skipped", skipped);
        out.put("version", version);
        return out;
    }

    /* ---------- 取消關聯 ---------- */

    public Map<String, Object> unlinkVersion(String caseId, String versionCode) {
        Case c = caseMapper.selectById(caseId);
        if (c == null) throw new BizException(4040, "案例不存在");
        List<String> arr = c.getVersions() != null ? new ArrayList<>(c.getVersions()) : new ArrayList<>();
        if (!arr.contains(versionCode)) throw new BizException(4040, "案例未關聯版本 " + versionCode);
        arr.remove(versionCode);
        c.setVersions(arr);
        caseMapper.updateById(c);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", c.getId());
        out.put("version", versionCode);
        out.put("linked", false);
        return out;
    }

    /* ---------- 審核 ---------- */

    public Case review(String id, String action, String comment) {
        Case c = caseMapper.selectById(id);
        if (c == null) throw new BizException(4040, "案例不存在");
        if (!"approve".equals(action) && !"reject".equals(action)) {
            throw new BizException(4000, "action 必須為 approve 或 reject");
        }
        String from = c.getStatus();
        String to = "approve".equals(action) ? "APPROVED" : "REJECTED";
        String reviewer = metaService.currentUser().getName();
        Review review = new Review();
        review.setReviewer(reviewer);
        review.setComment(comment == null ? "" : comment);
        review.setAt(TimeUtil.now());
        c.setStatus(to);
        c.setReview(review);
        c.setUpdatedAt(TimeUtil.now());
        caseMapper.updateById(c);

        AuditLog log = new AuditLog();
        log.setId("AL" + c.getId() + "-" + (auditLogMapper.selectCount(null) + 1));
        log.setCaseId(c.getId());
        log.setAction(action);
        log.setFromStatus(from);
        log.setToStatus(to);
        log.setOperator(reviewer);
        log.setAt(TimeUtil.now());
        log.setComment(comment == null ? "" : comment);
        auditLogMapper.insert(log);
        return caseMapper.selectById(id);
    }

    /* ---------- AI 生成 ---------- */

    public Map<String, Object> aiGenerate(String hostXml) {
        if (hostXml == null || hostXml.isEmpty()) throw new BizException(4000, "缺少 hostXml");
        Config cfg = configService.get();
        Config.Env env = null;
        if (cfg.getEnvironments() != null) {
            for (Config.Env e : cfg.getEnvironments()) if (Boolean.TRUE.equals(e.getCurrent())) env = e;
        }
        NewInput ni = generatorService.aiGenerate(hostXml, cfg.getUrlTemplate(), cfg.getDefaultHeaders(),
                env != null ? env.getBaseUrl() : "");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("newInput", ni);
        out.put("envId", env != null ? env.getId() : null);
        return out;
    }

    /* ---------- 執行 ---------- */

    public Run run(String id, JsonNode body) {
        Case c = caseMapper.selectById(id);
        if (c == null) throw new BizException(4040, "案例不存在");
        String version = null;
        if (body != null && body.hasNonNull("version")) {
            version = resolveVersion(body.get("version"));
            if (version == null) throw new BizException(4000, "版本號 " + body.get("version").asText() + " 不存在，請先到案例中心維護");
        }
        long existing = runMapper.selectCount(new LambdaQueryWrapper<Run>().eq(Run::getCaseId, id));
        RunContext ctx = RunContext.builder()
                .config(configService.get())
                .type("SINGLE")
                .runBy(metaService.currentUser().getName())
                .runIndex((int) existing + 1)
                .at(TimeUtil.now())
                .version(version)
                .build();
        Run run = generatorService.runCase(c, ctx);
        runMapper.insert(run);
        c.setLastRun(run);
        caseMapper.updateById(c);
        return run;
    }

    /* ---------- 運行歷史（分頁） ---------- */

    public PageResult<Map<String, Object>> listRuns(String caseId, Integer page, Integer pageSize) {
        Case c = caseMapper.selectById(caseId);
        if (c == null) throw new BizException(4040, "案例不存在");
        List<Run> runs = runMapper.selectList(new LambdaQueryWrapper<Run>().eq(Run::getCaseId, caseId));
        runs.sort((a, b) -> b.getStartedAt().compareTo(a.getStartedAt()));
        List<Map<String, Object>> mapped = new ArrayList<>();
        for (Run r : runs) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.getId());
            m.put("type", r.getType());
            m.put("version", r.getVersion() == null ? null : r.getVersion());
            m.put("verdict", r.getVerdict());
            String caseType = r.getCaseType() != null ? r.getCaseType() : c.getType();
            m.put("caseType", caseType == null ? "Regular" : caseType);
            String testType = r.getTestType() != null ? r.getTestType() : c.getTestType();
            m.put("testType", testType == null ? "SIT" : testType);
            m.put("summary", r.getDiff() != null ? r.getDiff().getSummary() : null);
            m.put("runBy", r.getRunBy());
            m.put("startedAt", r.getStartedAt());
            m.put("finishedAt", r.getFinishedAt());
            mapped.add(m);
        }
        return PageResult.paginate(mapped, page == null ? null : String.valueOf(page), pageSize == null ? null : String.valueOf(pageSize));
    }

    /* ---------- 審計日誌 ---------- */

    public List<AuditLog> auditLogs(String caseId) {
        LambdaQueryWrapper<AuditLog> w = new LambdaQueryWrapper<>();
        if (caseId != null && !caseId.isEmpty()) w.eq(AuditLog::getCaseId, caseId);
        List<AuditLog> list = auditLogMapper.selectList(w);
        list.sort((a, b) -> b.getAt().compareTo(a.getAt()));
        return list;
    }

    /* ---------- 工具 ---------- */

    private void ensureCaseType(String type) {
        long n = caseTypeMapper.selectCount(new LambdaQueryWrapper<CaseType>().eq(CaseType::getName, type));
        if (n == 0) throw new BizException(4000, "案例類型「" + type + "」不存在，請先到「案例中心 → 案例類型」維護");
    }

    private static boolean isEmpty(String s) {
        return s == null || s.isEmpty();
    }

    private static String text(JsonNode body, String key) {
        JsonNode n = body.get(key);
        return n == null || n.isNull() ? null : n.asText();
    }

    private static NewInput fromJson(JsonNode ni) {
        NewInput n = new NewInput();
        n.setUrl(ni.hasNonNull("url") ? ni.get("url").asText() : "");
        n.setMethod(ni.hasNonNull("method") ? ni.get("method").asText() : "");
        n.setBody(ni.hasNonNull("body") ? ni.get("body").asText() : "");
        if (ni.has("headers") && ni.get("headers").isArray()) {
            List<Case.HeaderDef> hs = new ArrayList<>();
            for (JsonNode h : ni.get("headers")) {
                Case.HeaderDef hd = new Case.HeaderDef();
                hd.setName(h.hasNonNull("name") ? h.get("name").asText() : "");
                hd.setValue(h.hasNonNull("value") ? h.get("value").asText() : "");
                if (h.has("enabled")) hd.setEnabled(h.get("enabled").asBoolean());
                if (h.has("secret")) hd.setSecret(h.get("secret").asBoolean());
                hs.add(hd);
            }
            n.setHeaders(hs);
        }
        if (ni.has("refinedByHuman")) n.setRefinedByHuman(ni.get("refinedByHuman").asBoolean());
        return n;
    }
}
