package com.boc.apitest.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boc.apitest.entity.Misc.Meta;
import com.boc.apitest.entity.Misc.SystemRec;
import com.boc.apitest.entity.Misc.UserInfo;
import com.boc.apitest.entity.Misc.Features;
import com.boc.apitest.mapper.Mappers.MetaMapper;
import com.boc.apitest.mapper.Mappers.SystemRecMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 運行元數據（mock/db.js db.meta 移植）：
 * - GET /api/meta/context → { currentUser, currentSystem, systems, features }
 * - GET /api/systems → systems 列表
 * meta 表 payload 存整份 JSON（與 JS db.meta 一致），systems 同時落獨立表供 /api/systems 使用。
 */
@Service
@RequiredArgsConstructor
public class MetaService {

    private static final String META_ID = "main";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final MetaMapper metaMapper;
    private final SystemRecMapper systemRecMapper;

    public Meta row() {
        Meta meta = metaMapper.selectOne(new LambdaQueryWrapper<Meta>().eq(Meta::getId, META_ID));
        if (meta == null) {
            meta = new Meta();
            meta.setId(META_ID);
            meta.setPayload("{}");
            metaMapper.insert(meta);
        }
        return meta;
    }

    public ObjectNode getContext() {
        Meta meta = row();
        JsonNode payload;
        try {
            payload = MAPPER.readTree(meta.getPayload());
        } catch (Exception e) {
            payload = MAPPER.createObjectNode();
        }
        ObjectNode ctx = MAPPER.createObjectNode();
        JsonNode currentUser = payload.has("currentUser") ? payload.get("currentUser") : null;
        if (currentUser != null) ctx.set("currentUser", currentUser);
        ctx.put("currentSystem", payload.has("currentSystem") ? payload.get("currentSystem").asText() : "EBP-CL");
        ctx.put("systems", MAPPER.valueToTree(listSystems()));
        ctx.set("features", payload.has("features") ? payload.get("features")
                : MAPPER.valueToTree(defaultFeatures()));
        return ctx;
    }

    public UserInfo currentUser() {
        try {
            JsonNode u = MAPPER.readTree(row().getPayload()).get("currentUser");
            if (u != null) return MAPPER.treeToValue(u, UserInfo.class);
        } catch (Exception ignored) {
        }
        UserInfo d = new UserInfo();
        d.setId("u001");
        d.setName("測試工程師 陳");
        d.setRole("tester");
        return d;
    }

    public String currentSystem() {
        try {
            JsonNode p = MAPPER.readTree(row().getPayload());
            if (p.has("currentSystem")) return p.get("currentSystem").asText();
        } catch (Exception ignored) {
        }
        return "EBP-CL";
    }

    public boolean aiEnabled() {
        try {
            JsonNode f = MAPPER.readTree(row().getPayload()).get("features");
            if (f != null && f.has("aiGenerate")) return f.get("aiGenerate").asBoolean();
        } catch (Exception ignored) {
        }
        return true;
    }

    private static Features defaultFeatures() {
        Features f = new Features();
        f.setAiGenerate(true);
        f.setCapture(false);
        f.setStress(true);
        f.setMultiSystem(false);
        return f;
    }

    public List<SystemRec> listSystems() {
        return systemRecMapper.selectList(new LambdaQueryWrapper<SystemRec>().orderByAsc(SystemRec::getId));
    }

    public void saveMeta(JsonNode payload) {
        Meta meta = row();
        meta.setPayload(payload.toString());
        metaMapper.updateById(meta);
    }
}
