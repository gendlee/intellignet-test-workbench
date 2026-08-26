package com.boc.apitest.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boc.apitest.entity.BatchRun;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Run;
import com.boc.apitest.mapper.Mappers.BatchRunMapper;
import com.boc.apitest.mapper.Mappers.CaseMapper;
import com.boc.apitest.mapper.Mappers.RunMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * 儀表盤（mock/routes.js 移植）：
 * summary 生命周期統計 / recent-runs / pending-reviews / charts
 * （status-distribution、module-distribution、module-cards、execution-trend）。
 */
@Service
@RequiredArgsConstructor
public class DashboardService {

    private static final DateTimeFormatter DAY_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private final CaseMapper caseMapper;
    private final RunMapper runMapper;
    private final BatchRunMapper batchRunMapper;

    public Map<String, Object> summary() {
        List<Case> cases = caseMapper.selectList(null);
        List<Run> runs = runMapper.selectList(null);
        long pass = runs.stream().filter(r -> "PASS".equals(r.getVerdict())).count();
        long reviewed = cases.stream().filter(c -> !"PENDING".equals(c.getStatus()) && !"DRAFT".equals(c.getStatus())).count();
        Set<String> executedIds = new HashSet<>();
        for (Run r : runs) executedIds.add(r.getCaseId());
        List<Case> executedCases = cases.stream().filter(c -> executedIds.contains(c.getId())).toList();
        Set<String> profiles = new HashSet<>();
        for (Case c : executedCases) profiles.add(c.getProfile());
        Set<String> txnCodes = new HashSet<>();
        for (Case c : cases) txnCodes.add(c.getTxnCode());
        BatchRun running = batchRunMapper.selectList(new LambdaQueryWrapper<BatchRun>().eq(BatchRun::getStatus, "running"))
                .stream().findFirst().orElse(null);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("totalCases", cases.size());
        out.put("totalRuns", runs.size());
        out.put("passRate", runs.isEmpty() ? 0 : Math.round(pass * 100.0 / runs.size()));
        out.put("pendingReviews", cases.stream().filter(c -> "PENDING".equals(c.getStatus())).count());
        out.put("reviewedCount", reviewed);
        out.put("approvedCount", cases.stream().filter(c -> "APPROVED".equals(c.getStatus())).count());
        out.put("rejectedCount", cases.stream().filter(c -> "REJECTED".equals(c.getStatus())).count());
        out.put("executedCount", executedCases.size());
        out.put("executedScenarios", profiles.size());
        out.put("coveredTxnCodes", txnCodes.size());
        out.put("runningBatch", running);
        return out;
    }

    public List<Map<String, Object>> recentRuns(int limit) {
        List<Run> runs = new ArrayList<>(runMapper.selectList(null));
        runs.sort((a, b) -> b.getStartedAt().compareTo(a.getStartedAt()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Run r : runs.stream().limit(limit).toList()) {
            Case c = caseMapper.selectById(r.getCaseId());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.getId());
            m.put("caseId", r.getCaseId());
            m.put("txnCode", c != null ? c.getTxnCode() : "");
            m.put("caseName", c != null ? c.getName() : "");
            m.put("verdict", r.getVerdict());
            m.put("stateType", c != null ? c.getStateType() : null);
            m.put("runBy", r.getRunBy());
            m.put("startedAt", r.getStartedAt());
            m.put("finishedAt", r.getFinishedAt());
            m.put("summary", r.getDiff() != null ? r.getDiff().getSummary() : null);
            out.add(m);
        }
        return out;
    }

    public List<Map<String, Object>> pendingReviews(int limit) {
        List<Case> cases = caseMapper.selectList(new LambdaQueryWrapper<Case>().eq(Case::getStatus, "PENDING"));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Case c : cases.stream().limit(limit).toList()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", c.getId());
            m.put("txnCode", c.getTxnCode());
            m.put("name", c.getName());
            m.put("module", c.getModule());
            m.put("createdBy", c.getCreatedBy());
            m.put("createdAt", c.getCreatedAt());
            out.add(m);
        }
        return out;
    }

    public Object charts(String type) {
        Map<String, Object> out = new LinkedHashMap<>();
        if ("status-distribution".equals(type)) {
            List<String> labels = List.of("DRAFT", "PENDING", "APPROVED", "REJECTED");
            List<Case> cases = caseMapper.selectList(null);
            List<Integer> series = new ArrayList<>();
            for (String l : labels) {
                int n = 0;
                for (Case c : cases) if (l.equals(c.getStatus())) n++;
                series.add(n);
            }
            out.put("labels", labels);
            out.put("series", series);
            return out;
        }
        if ("module-distribution".equals(type)) {
            Map<String, Integer> map = new LinkedHashMap<>();
            for (Case c : caseMapper.selectList(null)) map.merge(c.getModule(), 1, Integer::sum);
            out.put("labels", new ArrayList<>(map.keySet()));
            out.put("series", new ArrayList<>(map.values()));
            return out;
        }
        if ("module-cards".equals(type)) {
            List<Case> cases = caseMapper.selectList(null);
            List<Run> runs = runMapper.selectList(null);
            Set<String> mods = new TreeSet<>();
            for (Case c : cases) mods.add(c.getModule() == null || c.getModule().isEmpty() ? "未分類" : c.getModule());
            List<Map<String, Object>> outList = new ArrayList<>();
            for (String m : mods) {
                List<Case> caseRecs = cases.stream()
                        .filter(c -> (c.getModule() == null || c.getModule().isEmpty() ? "未分類" : c.getModule()).equals(m))
                        .toList();
                Set<String> ids = new HashSet<>();
                for (Case c : caseRecs) ids.add(c.getId());
                List<Run> runRecs = runs.stream().filter(r -> ids.contains(r.getCaseId())).toList();
                long pass = runRecs.stream().filter(r -> "PASS".equals(r.getVerdict())).count();
                Run last = runRecs.stream()
                        .sorted((a, b) -> b.getStartedAt().compareTo(a.getStartedAt()))
                        .findFirst().orElse(null);
                Map<String, Object> card = new LinkedHashMap<>();
                card.put("module", m);
                card.put("caseCount", caseRecs.size());
                card.put("runCount", runRecs.size());
                card.put("passRate", runRecs.isEmpty() ? null : Math.round(pass * 100.0 / runRecs.size()));
                card.put("lastVerdict", last != null ? last.getVerdict() : null);
                card.put("lastRunAt", last != null ? last.getStartedAt() : null);
                outList.add(card);
            }
            return outList;
        }
        if ("execution-trend".equals(type)) {
            List<Run> runs = runMapper.selectList(null);
            List<String> labels = new ArrayList<>();
            List<Integer> pass = new ArrayList<>();
            List<Integer> diff = new ArrayList<>();
            List<Integer> fail = new ArrayList<>();
            for (int d = 6; d >= 0; d--) {
                String day = LocalDate.now(ZoneId.systemDefault()).minusDays(d).format(DAY_FMT);
                labels.add(day.substring(5));
                int p = 0, di = 0, f = 0;
                for (Run r : runs) {
                    if (r.getStartedAt() == null || !r.getStartedAt().startsWith(day)) continue;
                    if ("PASS".equals(r.getVerdict())) p++;
                    else if ("DIFF".equals(r.getVerdict())) di++;
                    else if ("FAIL".equals(r.getVerdict())) f++;
                }
                pass.add(p);
                diff.add(di);
                fail.add(f);
            }
            List<Map<String, Object>> series = new ArrayList<>();
            series.add(series("通過", pass));
            series.add(series("差異", diff));
            series.add(series("失敗", fail));
            out.put("labels", labels);
            out.put("series", series);
            return out;
        }
        throw new com.boc.apitest.common.BizException(4000, "未知圖表類型：" + type);
    }

    private static Map<String, Object> series(String name, List<Integer> data) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("data", data);
        return m;
    }
}
