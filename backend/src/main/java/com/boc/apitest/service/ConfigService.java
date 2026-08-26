package com.boc.apitest.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boc.apitest.diff.Comparators.DiffRules;
import com.boc.apitest.entity.Case.HeaderDef;
import com.boc.apitest.entity.Misc.Config;
import com.boc.apitest.mapper.Mappers.ConfigMapper;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 系統配置 GET / PUT（mock/routes.js 部分合併邏輯移植）：
 * - urlTemplate / defaultHeaders 整值替換
 * - diffRules 深度合併（{...prev, ...body.diffRules}）
 * - environments 整值替換，保證「恰有一個 current」；name/baseUrl 缺省補值
 * - ai 合併；apiKey 含「•」脱敏值不落庫，保留原密鑰
 */
@Service
@RequiredArgsConstructor
public class ConfigService {

    private static final String CONFIG_ID = "main";

    private final ConfigMapper configMapper;

    public Config get() {
        Config cfg = configMapper.selectOne(new LambdaQueryWrapper<Config>().eq(Config::getId, CONFIG_ID));
        if (cfg == null) {
            cfg = new Config();
            cfg.setId(CONFIG_ID);
            configMapper.insert(cfg);
        }
        return cfg;
    }

    public Config update(JsonNode body) {
        Config cfg = get();
        if (body.has("urlTemplate")) cfg.setUrlTemplate(parseList(body.get("urlTemplate"), Config.UrlTemplateSeg.class));
        if (body.has("defaultHeaders")) cfg.setDefaultHeaders(parseList(body.get("defaultHeaders"), HeaderDef.class));
        if (body.has("diffRules")) {
            JsonNode d = body.get("diffRules");
            DiffRules prev = cfg.getDiffRules() != null ? cfg.getDiffRules() : new DiffRules();
            DiffRules merged = new DiffRules();
            merged.arrayMatchMode = d.hasNonNull("arrayMatchMode") ? d.get("arrayMatchMode").asText() : prev.arrayMatchMode;
            merged.arrayMatchKeys = d.hasNonNull("arrayMatchKeys") ? parseMap(d.get("arrayMatchKeys")) : prev.arrayMatchKeys;
            merged.ignoreFields = d.hasNonNull("ignoreFields") ? stringList(d.get("ignoreFields")) : prev.ignoreFields;
            merged.dynamicRegex = d.hasNonNull("dynamicRegex") ? stringList(d.get("dynamicRegex")) : prev.dynamicRegex;
            merged.numeric = d.hasNonNull("numeric") ? d.get("numeric").asText() : prev.numeric;
            merged.numericTolerance = d.hasNonNull("numericTolerance") ? d.get("numericTolerance").asDouble() : prev.numericTolerance;
            merged.longNumberGuard = d.hasNonNull("longNumberGuard") ? d.get("longNumberGuard").asInt() : prev.longNumberGuard;
            merged.timeNormalize = d.hasNonNull("timeNormalize") ? d.get("timeNormalize").asBoolean() : prev.timeNormalize;
            merged.collapseSingleArray = d.hasNonNull("collapseSingleArray") ? d.get("collapseSingleArray").asBoolean() : prev.collapseSingleArray;
            merged.attrMerge = d.hasNonNull("attrMerge") ? d.get("attrMerge").asBoolean() : prev.attrMerge;
            merged.namespaceInsensitive = d.hasNonNull("namespaceInsensitive") ? d.get("namespaceInsensitive").asBoolean() : prev.namespaceInsensitive;
            merged.emptyEqualsNull = d.hasNonNull("emptyEqualsNull") ? d.get("emptyEqualsNull").asBoolean() : prev.emptyEqualsNull;
            merged.wrapIgnoreKeys = d.hasNonNull("wrapIgnoreKeys") ? stringList(d.get("wrapIgnoreKeys")) : prev.wrapIgnoreKeys;
            cfg.setDiffRules(merged);
        }
        if (body.has("environments")) {
            // 環境整值替換：保證恰有一個 current
            List<Config.Env> envs = parseList(body.get("environments"), Config.Env.class);
            List<Config.Env> filtered = new ArrayList<>();
            for (Config.Env e : envs) {
                if (e != null && e.getId() != null && !e.getId().isEmpty()) filtered.add(e);
            }
            boolean anyCurrent = false;
            for (Config.Env e : filtered) if (Boolean.TRUE.equals(e.getCurrent())) anyCurrent = true;
            if (!anyCurrent && !filtered.isEmpty()) {
                filtered.get(0).setCurrent(true);
            }
            List<Config.Env> out = new ArrayList<>();
            for (Config.Env e : filtered) {
                Config.Env n = new Config.Env();
                n.setId(e.getId());
                n.setName(e.getName() == null || e.getName().isEmpty() ? e.getId() : e.getName());
                n.setBaseUrl(e.getBaseUrl() == null ? "" : e.getBaseUrl());
                n.setCurrent(Boolean.TRUE.equals(e.getCurrent()));
                out.add(n);
            }
            cfg.setEnvironments(out);
        }
        if (body.has("ai")) {
            JsonNode a = body.get("ai");
            Config.AiConfig prev = cfg.getAi() != null ? cfg.getAi() : new Config.AiConfig();
            Config.AiConfig ai = new Config.AiConfig();
            ai.setEnabled(a.hasNonNull("enabled") ? a.get("enabled").asBoolean() : prev.getEnabled());
            ai.setMode(a.hasNonNull("mode") ? a.get("mode").asText() : prev.getMode());
            ai.setApiBase((a.hasNonNull("apiBase") ? a.get("apiBase").asText() : prev.getApiBase() == null ? "" : prev.getApiBase()).trim());
            ai.setModel((a.hasNonNull("model") ? a.get("model").asText() : prev.getModel() == null ? "" : prev.getModel()).trim());
            // 脱敏值（含 •）不落庫，保留原密鑰
            String keyRaw = a.hasNonNull("apiKey") ? a.get("apiKey").asText() : "";
            ai.setApiKey(keyRaw.contains("•") ? prev.getApiKey() : keyRaw);
            cfg.setAi(ai);
        }
        configMapper.updateById(cfg);
        return cfg;
    }

    private static <T> List<T> parseList(JsonNode node, Class<T> type) {
        if (node == null || !node.isArray()) return new ArrayList<>();
        try {
            return com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                    .treeToValue(node, new com.fasterxml.jackson.core.type.TypeReference<List<T>>() {});
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    private static List<String> stringList(JsonNode node) {
        List<String> out = new ArrayList<>();
        if (node != null && node.isArray()) node.forEach(n -> out.add(n.asText()));
        return out;
    }

    private static Map<String, String> parseMap(JsonNode node) {
        Map<String, String> out = new java.util.LinkedHashMap<>();
        if (node != null && node.isObject()) node.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().asText()));
        return out;
    }
}
