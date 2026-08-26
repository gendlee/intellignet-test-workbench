package com.boc.apitest.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boc.apitest.common.BizException;
import com.boc.apitest.common.TimeUtil;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Case.Review;
import com.boc.apitest.entity.StressPlan;
import com.boc.apitest.entity.StressRun;
import com.boc.apitest.mapper.Mappers.StressPlanMapper;
import com.boc.apitest.mapper.Mappers.StressRunMapper;
import com.boc.apitest.service.GeneratorService;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 壓測計劃（mock/routes.js 移植）：
 * 狀態機 pending → approved/rejected → running → done；未審批禁止啟動（4030）；
 * 運行中禁止審批；/run 後 1.6s 異步生成曲線（buildStressRun）並置 done。
 */
@Service
@RequiredArgsConstructor
public class StressService {

    private static final long STRESS_DELAY_MS = 1600;

    private final StressPlanMapper planMapper;
    private final StressRunMapper stressRunMapper;
    private final AsyncRunner asyncRunner;
    private final GeneratorService generatorService;
    private final MetaService metaService;
    private final SeqService seqService;

    /* ---------- 列表（lastRun 裁剪） ---------- */

    public List<Map<String, Object>> listPlans() {
        List<StressPlan> plans = new ArrayList<>(planMapper.selectList(null));
        plans.sort((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (StressPlan p : plans) out.add(trim(p));
        return out;
    }

    private static Map<String, Object> trim(StressPlan p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId());
        m.put("name", p.getName());
        m.put("method", p.getMethod());
        m.put("url", p.getUrl());
        m.put("headers", p.getHeaders());
        m.put("body", p.getBody());
        m.put("concurrency", p.getConcurrency());
        m.put("durationSec", p.getDurationSec());
        m.put("rampUpSec", p.getRampUpSec());
        m.put("status", p.getStatus());
        m.put("review", p.getReview());
        m.put("runCount", p.getRunCount());
        m.put("createdBy", p.getCreatedBy());
        m.put("createdAt", p.getCreatedAt());
        m.put("lastRun", p.getLastRun() != null ? trimRun(p.getLastRun()) : null);
        return m;
    }

    private static Map<String, Object> trimRun(StressRun r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.getId());
        m.put("status", r.getStatus());
        m.put("summary", r.getSummary());
        m.put("startedAt", r.getStartedAt());
        m.put("finishedAt", r.getFinishedAt());
        return m;
    }

    /* ---------- 建立（新建即 pending，需審批） ---------- */

    public Map<String, Object> createPlan(JsonNode body) {
        String name = text(body, "name");
        String url = text(body, "url");
        if (isEmpty(name) || isEmpty(url)) throw new BizException(4000, "計劃名稱與接口地址必填");
        StressPlan p = new StressPlan();
        p.setId(seqService.nextId(SeqService.PREFIX_PLAN));
        p.setName(name);
        p.setMethod(has(body, "method") && !isEmpty(text(body, "method")) ? text(body, "method") : "POST");
        p.setUrl(url);
        p.setHeaders(body.has("headers") && body.get("headers").isArray()
                ? parseHeaders(body.get("headers")) : null);
        p.setBody(text(body, "body") == null ? "" : text(body, "body"));
        int duration = Math.max(5, num(body, "durationSec", 60));
        p.setConcurrency(Math.max(1, num(body, "concurrency", 10)));
        p.setDurationSec(duration);
        p.setRampUpSec(Math.min(Math.max(1, num(body, "rampUpSec", 10)), duration));
        p.setStatus("pending");
        p.setReview(null);
        p.setRunCount(0);
        p.setCreatedBy(metaService.currentUser().getName());
        p.setCreatedAt(TimeUtil.now());
        planMapper.insert(p);
        return trim(p);
    }

    public Map<String, Object> updatePlan(String id, JsonNode body) {
        StressPlan p = planMapper.selectById(id);
        if (p == null) throw new BizException(4040, "計劃不存在");
        for (String k : new String[]{"name", "method", "url", "body", "concurrency", "durationSec", "rampUpSec"}) {
            if (body.has(k)) {
                if ("concurrency".equals(k)) p.setConcurrency(Math.max(1, body.get(k).asInt()));
                else if ("durationSec".equals(k)) p.setDurationSec(Math.max(5, body.get(k).asInt()));
                else if ("rampUpSec".equals(k)) p.setRampUpSec(Math.min(Math.max(1, body.get(k).asInt()), p.getDurationSec() != null ? p.getDurationSec() : 60));
                else if ("headers".equals(k) && body.get(k).isArray()) p.setHeaders(parseHeaders(body.get(k)));
                else if (body.hasNonNull(k)) {
                    if ("name".equals(k)) p.setName(body.get(k).asText());
                    else if ("method".equals(k)) p.setMethod(body.get(k).asText());
                    else if ("url".equals(k)) p.setUrl(body.get(k).asText());
                    else if ("body".equals(k)) p.setBody(body.get(k).asText());
                }
            }
        }
        planMapper.updateById(p);
        return trim(p);
    }

    public Map<String, Object> deletePlan(String id) {
        StressPlan p = planMapper.selectById(id);
        if (p == null) throw new BizException(4040, "計劃不存在");
        planMapper.deleteById(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("deleted", true);
        return out;
    }

    public Map<String, Object> getPlan(String id) {
        StressPlan p = planMapper.selectById(id);
        if (p == null) throw new BizException(4040, "計劃不存在");
        return trim(p);
    }

    /* ---------- 啟動（僅 approved/done 可啟動） ---------- */

    public Map<String, Object> runPlan(String id) {
        StressPlan p = planMapper.selectById(id);
        if (p == null) throw new BizException(4040, "計劃不存在");
        if ("running".equals(p.getStatus())) throw new BizException(4000, "該計劃正在運行中");
        if (!"approved".equals(p.getStatus()) && !"done".equals(p.getStatus())) {
            throw new BizException(4030, "pending".equals(p.getStatus())
                    ? "計劃尚未審批通過，需先由審批人批准後才可執行"
                    : "計劃已被駁回，無法執行");
        }
        startStress(p);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", p.getId());
        out.put("status", "running");
        return out;
    }

    private void startStress(StressPlan p) {
        p.setStatus("running");
        p.setRunCount((p.getRunCount() == null ? 0 : p.getRunCount()) + 1);
        planMapper.updateById(p);
        asyncRunner.executor().schedule(() -> {
            try {
                StressRun run = generatorService.buildStressRun(p, TimeUtil.now());
                stressRunMapper.insert(run);
                StressPlan latest = planMapper.selectById(p.getId());
                if (latest == null) return;
                latest.setStatus("done");
                latest.setLastRun(run);
                planMapper.updateById(latest);
            } catch (Exception e) {
                // 模擬完成失敗不中斷（與 JS setTimeout 回調無異常處理一致）
            }
        }, STRESS_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    /* ---------- 審批 ---------- */

    public Map<String, Object> reviewPlan(String id, String action, String comment) {
        StressPlan p = planMapper.selectById(id);
        if (p == null) throw new BizException(4040, "計劃不存在");
        if (!"approve".equals(action) && !"reject".equals(action)) {
            throw new BizException(4000, "action 必須為 approve 或 reject");
        }
        if ("running".equals(p.getStatus())) throw new BizException(4000, "運行中的計劃不能審批");
        p.setStatus("approve".equals(action) ? "approved" : "rejected");
        Review review = new Review();
        review.setReviewer(metaService.currentUser().getName());
        review.setComment(comment == null ? "" : comment);
        review.setAt(TimeUtil.now());
        p.setReview(review);
        planMapper.updateById(p);
        return trim(p);
    }

    /* ---------- 壓測運行詳情 ---------- */

    public StressRun getStressRun(String id) {
        StressRun r = stressRunMapper.selectById(id);
        if (r == null) throw new BizException(4040, "壓測運行不存在");
        return r;
    }

    /* ---------- 工具 ---------- */

    private static List<Case.HeaderDef> parseHeaders(JsonNode arr) {
        List<Case.HeaderDef> hs = new ArrayList<>();
        for (JsonNode h : arr) {
            Case.HeaderDef hd = new Case.HeaderDef();
            hd.setName(h.hasNonNull("name") ? h.get("name").asText() : "");
            hd.setValue(h.hasNonNull("value") ? h.get("value").asText() : "");
            if (h.has("enabled")) hd.setEnabled(h.get("enabled").asBoolean());
            if (h.has("secret")) hd.setSecret(h.get("secret").asBoolean());
            hs.add(hd);
        }
        return hs;
    }

    private static boolean isEmpty(String s) {
        return s == null || s.isEmpty();
    }

    private static String text(JsonNode body, String key) {
        JsonNode n = body.get(key);
        return n == null || n.isNull() ? null : n.asText();
    }

    private static boolean has(JsonNode body, String key) {
        return body.has(key) && !body.get(key).isNull();
    }

    private static int num(JsonNode body, String key, int def) {
        JsonNode n = body.get(key);
        if (n == null || n.isNull()) return def;
        try {
            return n.asInt(def);
        } catch (Exception e) {
            return def;
        }
    }
}
