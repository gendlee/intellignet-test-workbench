package com.boc.apitest.service;

import com.boc.apitest.common.BizException;
import com.boc.apitest.diff.DiffModels.DiffItem;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Misc.Config;
import com.boc.apitest.entity.Run;
import com.boc.apitest.mapper.Mappers.CaseMapper;
import com.boc.apitest.mapper.Mappers.RunMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 初步分析（mock/routes.js /api/ai/analyze 移植）：
 * - config.ai.enabled 關閉 → 4000「AI 分析未啟用」
 * - mode=remote 且配置 apiBase → 外部 AI API 轉發（Bearer apiKey，body {prompt, model}，
 *   兼容 {choices[].message.content} / {content} / {result} / {output}）
 * - 外部調用失敗 → 回退本地規則分析並在 disclaimer 標注
 */
@Service
@RequiredArgsConstructor
public class AiService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ConfigService configService;
    private final CaseMapper caseMapper;
    private final RunMapper runMapper;
    private final AiAnalyzer aiAnalyzer;

    public Map<String, Object> analyze(String caseId, String runId) {
        Config.AiConfig cfg = configService.get().getAi();
        if (cfg == null || !Boolean.TRUE.equals(cfg.getEnabled())) {
            throw new BizException(4000, "AI 分析未啟用（可在系統配置中開啟）");
        }
        Case c = caseId != null ? caseMapper.selectById(caseId) : null;
        Run run = null;
        if (runId != null) {
            run = runMapper.selectById(runId);
        } else if (c != null) {
            run = runMapper.selectList(new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<Run>()
                    .eq(Run::getCaseId, c.getId()).orderByDesc(Run::getStartedAt).last("limit 1"))
                    .stream().findFirst().orElse(null);
        }
        if (run == null) throw new BizException(4040, "找不到對應的運行記錄");
        if ("remote".equals(cfg.getMode()) && cfg.getApiBase() != null && !cfg.getApiBase().isEmpty()) {
            try {
                return remoteAnalyze(run, c, cfg);
            } catch (Exception e) {
                Map<String, Object> local = aiAnalyzer.analyzeFailure(run, c);
                String disc = String.valueOf(local.get("disclaimer"));
                local.put("disclaimer", disc + "（外部 AI 調用失敗，已回退本地規則分析：" + e.getMessage() + "）");
                return local;
            }
        }
        return aiAnalyzer.analyzeFailure(run, c);
    }

    private Map<String, Object> remoteAnalyze(Run run, Case c, Config.AiConfig cfg) throws IOException, InterruptedException {
        StringBuilder items = new StringBuilder();
        int n = 0;
        if (run.getDiff() != null && run.getDiff().getItems() != null) {
            for (DiffItem i : run.getDiff().getItems()) {
                if (n++ >= 20) break;
                items.append(i.getKind()).append(' ').append(String.join(".", i.getPath()))
                        .append("：主機=").append(i.getHostValue() == null ? "" : i.getHostValue())
                        .append(" vs 微服務=").append(i.getNewValue() == null ? "" : i.getNewValue())
                        .append('\n');
            }
        }
        StringBuilder prompt = new StringBuilder();
        prompt.append("你是銀行接口測試分析助手。案例：").append(c != null ? c.getName() : "")
                .append("（").append(c != null ? c.getTxnCode() : "").append("），判定：").append(run.getVerdict()).append("。\n");
        if (run.getDiff() != null) {
            prompt.append("兩側報文字段級差異：\n").append(items.length() == 0 ? "（無）" : items);
        } else {
            Integer httpStatus = run.getNewResult() != null ? run.getNewResult().getHttpStatus() : null;
            prompt.append("HTTP 狀態：").append(httpStatus != null ? httpStatus : "未知").append("，步驟：");
            if (run.getSteps() != null) {
                List<String> steps = new ArrayList<>();
                for (Run.Step s : run.getSteps()) steps.add(s.getName() + ":" + s.getStatus());
                prompt.append(String.join(",", steps));
            }
            prompt.append('\n');
        }
        prompt.append("請以 JSON 返回 { summary, reasons: [{level:\"error|warn|info\", text}], confidence }，簡潔列舉最可能的原因。");

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("prompt", prompt.toString());
        payload.put("model", cfg.getModel() == null || cfg.getModel().isEmpty() ? "default" : cfg.getModel());
        payload.put("stream", false);
        HttpRequest.Builder req = HttpRequest.newBuilder()
                .uri(URI.create(cfg.getApiBase()))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(payload)));
        if (cfg.getApiKey() != null && !cfg.getApiKey().isEmpty()) {
            req.header("Authorization", "Bearer " + cfg.getApiKey());
        }
        HttpResponse<String> res = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
                .send(req.build(), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() < 200 || res.statusCode() >= 300) {
            throw new IOException("外部 AI API HTTP " + res.statusCode());
        }
        JsonNode j;
        try {
            j = MAPPER.readTree(res.body());
        } catch (Exception e) {
            throw new IOException("外部 AI API 響應非 JSON");
        }
        String content = null;
        JsonNode choices = j.get("choices");
        if (choices != null && choices.isArray() && !choices.isEmpty()
                && choices.get(0).has("message") && choices.get(0).get("message").has("content")) {
            content = choices.get(0).get("message").get("content").asText();
        } else if (j.hasNonNull("content")) content = j.get("content").asText();
        else if (j.hasNonNull("result")) content = j.get("result").asText();
        else if (j.hasNonNull("output")) content = j.get("output").asText();
        if (content == null) throw new IOException("外部 AI API 響應缺少 content");

        JsonNode parsed;
        try {
            parsed = MAPPER.readTree(content);
        } catch (Exception e) {
            parsed = MAPPER.createObjectNode().put("summary", content);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("summary", parsed.hasNonNull("summary") ? parsed.get("summary").asText()
                : content.length() > 200 ? content.substring(0, 200) : content);
        List<Map<String, Object>> reasons = new ArrayList<>();
        if (parsed.has("reasons") && parsed.get("reasons").isArray()) {
            int cnt = 0;
            for (JsonNode r : parsed.get("reasons")) {
                if (cnt++ >= 8) break;
                Map<String, Object> m = new LinkedHashMap<>();
                if (r.isObject()) {
                    m.put("level", r.hasNonNull("level") ? r.get("level").asText() : "info");
                    m.put("text", r.hasNonNull("text") ? r.get("text").asText() : "");
                } else {
                    m.put("level", "info");
                    m.put("text", r.asText());
                }
                reasons.add(m);
            }
        }
        out.put("reasons", reasons);
        out.put("confidence", parsed.hasNonNull("confidence") ? parsed.get("confidence").asText() : "中");
        out.put("disclaimer", AiAnalyzer.DISCLAIMER);
        out.put("model", cfg.getModel() == null || cfg.getModel().isEmpty() ? "external" : cfg.getModel());
        return out;
    }
}
