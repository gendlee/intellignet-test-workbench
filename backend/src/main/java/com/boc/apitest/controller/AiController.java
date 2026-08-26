package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.service.AiService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** AI 初步分析（POST /api/ai/analyze） */
@RestController
@RequiredArgsConstructor
public class AiController {

    private final AiService aiService;

    @PostMapping("/api/ai/analyze")
    public ApiResponse<Map<String, Object>> analyze(@RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactory.instance.objectNode() : body;
        String caseId = body.hasNonNull("caseId") ? body.get("caseId").asText() : null;
        String runId = body.hasNonNull("runId") ? body.get("runId").asText() : null;
        return ApiResponse.ok(aiService.analyze(caseId, runId));
    }
}
