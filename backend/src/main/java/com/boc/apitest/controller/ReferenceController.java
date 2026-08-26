package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.entity.Misc.CaseType;
import com.boc.apitest.entity.Misc.Module;
import com.boc.apitest.entity.Misc.Version;
import com.boc.apitest.service.ReferenceService;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 引用數據：業務模組 / 案例類型 / 版本號 CRUD */
@RestController
@RequiredArgsConstructor
public class ReferenceController {

    private final ReferenceService referenceService;

    /* ---------- 業務模組 ---------- */

    @GetMapping("/api/modules")
    public ApiResponse<List<Module>> modules() {
        return ApiResponse.ok(referenceService.listModules());
    }

    @PostMapping("/api/modules")
    public ApiResponse<Module> createModule(@RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactoryObj.object() : body;
        return ApiResponse.ok(referenceService.createModule(
                text(body, "name"), text(body, "code"), text(body, "description")));
    }

    @PutMapping("/api/modules/{id}")
    public ApiResponse<Module> updateModule(@PathVariable String id, @RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactoryObj.object() : body;
        return ApiResponse.ok(referenceService.updateModule(id,
                text(body, "name"), text(body, "code"), text(body, "description"), body.has("description")));
    }

    @DeleteMapping("/api/modules/{id}")
    public ApiResponse<java.util.Map<String, Object>> deleteModule(@PathVariable String id) {
        referenceService.deleteModule(id);
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", id);
        m.put("deleted", true);
        return ApiResponse.ok(m);
    }

    /* ---------- 案例類型 ---------- */

    @GetMapping("/api/case-types")
    public ApiResponse<List<CaseType>> caseTypes() {
        return ApiResponse.ok(referenceService.listCaseTypes());
    }

    @PostMapping("/api/case-types")
    public ApiResponse<CaseType> createCaseType(@RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactoryObj.object() : body;
        return ApiResponse.ok(referenceService.createCaseType(text(body, "name"), text(body, "description")));
    }

    @PutMapping("/api/case-types/{id}")
    public ApiResponse<CaseType> updateCaseType(@PathVariable String id, @RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactoryObj.object() : body;
        return ApiResponse.ok(referenceService.updateCaseType(id,
                text(body, "name"), text(body, "description"), body.has("description")));
    }

    @DeleteMapping("/api/case-types/{id}")
    public ApiResponse<java.util.Map<String, Object>> deleteCaseType(@PathVariable String id) {
        referenceService.deleteCaseType(id);
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", id);
        m.put("deleted", true);
        return ApiResponse.ok(m);
    }

    /* ---------- 版本號 ---------- */

    @GetMapping("/api/versions")
    public ApiResponse<List<Version>> versions() {
        return ApiResponse.ok(referenceService.listVersions());
    }

    @PostMapping("/api/versions")
    public ApiResponse<Version> createVersion(@RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactoryObj.object() : body;
        return ApiResponse.ok(referenceService.createVersion(text(body, "month"), text(body, "mode")));
    }

    @DeleteMapping("/api/versions/{id}")
    public ApiResponse<java.util.Map<String, Object>> deleteVersion(@PathVariable String id) {
        referenceService.deleteVersion(id);
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", id);
        m.put("deleted", true);
        return ApiResponse.ok(m);
    }

    private static String text(JsonNode body, String key) {
        JsonNode n = body.get(key);
        return n == null || n.isNull() ? null : n.asText();
    }

    private static final class JsonNodeFactoryObj {
        static JsonNode object() {
            return com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        }
    }
}
