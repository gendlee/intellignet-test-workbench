package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.common.PageResult;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Misc.AuditLog;
import com.boc.apitest.entity.Run;
import com.boc.apitest.service.CaseService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 案例中心（CRUD / 批量關聯版本 / 審核 / AI 生成 / 執行 / 運行歷史） */
@RestController
@RequiredArgsConstructor
public class CasesController {

    private final CaseService caseService;

    private static JsonNode body(JsonNode b) {
        return b == null ? JsonNodeFactory.instance.objectNode() : b;
    }

    @GetMapping("/api/cases")
    public ApiResponse<PageResult<Case>> list(@RequestParam(defaultValue = "") String txnCode,
                                              @RequestParam(defaultValue = "") String keyword,
                                              @RequestParam(defaultValue = "") String status,
                                              @RequestParam(defaultValue = "") String module,
                                              @RequestParam(defaultValue = "") String version,
                                              @RequestParam(required = false) Integer page,
                                              @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(caseService.listCases(txnCode, keyword, status, module, version, page, pageSize));
    }

    @GetMapping("/api/cases/{id}")
    public ApiResponse<Case> get(@PathVariable String id) {
        return ApiResponse.ok(caseService.getCase(id));
    }

    @PostMapping("/api/cases")
    public ApiResponse<Case> create(@RequestBody(required = false) JsonNode body) {
        return ApiResponse.ok(caseService.createCase(body(body)));
    }

    @PutMapping("/api/cases/{id}")
    public ApiResponse<Case> update(@PathVariable String id, @RequestBody(required = false) JsonNode body) {
        return ApiResponse.ok(caseService.updateCase(id, body(body)));
    }

    @DeleteMapping("/api/cases/{id}")
    public ApiResponse<Map<String, Object>> delete(@PathVariable String id) {
        caseService.deleteCase(id);
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", id);
        m.put("deleted", true);
        return ApiResponse.ok(m);
    }

    /* ---------- 批量關聯版本（幂等） ---------- */

    @PostMapping("/api/cases/batch-link")
    public ApiResponse<Map<String, Object>> batchLink(@RequestBody(required = false) JsonNode body) {
        body = body(body);
        List<String> ids = new java.util.ArrayList<>();
        if (body.has("caseIds") && body.get("caseIds").isArray()) {
            for (JsonNode n : body.get("caseIds")) ids.add(n.asText());
        }
        return ApiResponse.ok(caseService.batchLink(ids, body.get("version")));
    }

    @DeleteMapping("/api/cases/{id}/versions/{code}")
    public ApiResponse<Map<String, Object>> unlink(@PathVariable String id, @PathVariable String code) {
        return ApiResponse.ok(caseService.unlinkVersion(id, code));
    }

    /* ---------- 審核 ---------- */

    @PostMapping("/api/cases/{id}/review")
    public ApiResponse<Case> review(@PathVariable String id, @RequestBody(required = false) JsonNode body) {
        body = body(body);
        String comment = body.hasNonNull("comment") ? body.get("comment").asText() : null;
        return ApiResponse.ok(caseService.review(id, body.hasNonNull("action") ? body.get("action").asText() : null, comment));
    }

    /* ---------- AI 生成 ---------- */

    @PostMapping("/api/cases/ai-generate")
    public ApiResponse<Map<String, Object>> aiGenerate(@RequestBody(required = false) JsonNode body) {
        body = body(body);
        String hostXml = body.hasNonNull("hostXml") ? body.get("hostXml").asText() : null;
        return ApiResponse.ok(caseService.aiGenerate(hostXml));
    }

    /* ---------- 執行 ---------- */

    @PostMapping("/api/cases/{id}/run")
    public ApiResponse<Run> run(@PathVariable String id, @RequestBody(required = false) JsonNode body) {
        return ApiResponse.ok(caseService.run(id, body));
    }

    @GetMapping("/api/cases/{id}/runs")
    public ApiResponse<PageResult<Map<String, Object>>> runs(@PathVariable String id,
                                                             @RequestParam(required = false) Integer page,
                                                             @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(caseService.listRuns(id, page, pageSize));
    }

    /* ---------- 審計日誌 ---------- */

    @GetMapping("/api/audit-logs")
    public ApiResponse<List<AuditLog>> auditLogs(@RequestParam(required = false) String caseId) {
        return ApiResponse.ok(caseService.auditLogs(caseId));
    }

    /* ---------- Word 導出（預留端點） ---------- */

    @GetMapping("/api/cases/export-word")
    public ApiResponse<Map<String, String>> exportWord() {
        Map<String, String> m = new java.util.LinkedHashMap<>();
        m.put("note", "此端點為預留：Word 導出目前由前端本地生成（HTML→.doc）");
        return ApiResponse.ok(m);
    }
}
