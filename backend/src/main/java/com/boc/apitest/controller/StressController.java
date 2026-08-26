package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.entity.StressRun;
import com.boc.apitest.service.StressService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 壓測計劃（CRUD / 審批 / 啟動）與壓測運行詳情 */
@RestController
@RequiredArgsConstructor
public class StressController {

    private final StressService stressService;

    @GetMapping("/api/stress/plans")
    public ApiResponse<List<Map<String, Object>>> plans() {
        return ApiResponse.ok(stressService.listPlans());
    }

    @PostMapping("/api/stress/plans")
    public ApiResponse<Map<String, Object>> create(@RequestBody(required = false) JsonNode body) {
        return ApiResponse.ok(stressService.createPlan(body == null ? JsonNodeFactory.instance.objectNode() : body));
    }

    @PutMapping("/api/stress/plans/{id}")
    public ApiResponse<Map<String, Object>> update(@PathVariable String id, @RequestBody(required = false) JsonNode body) {
        return ApiResponse.ok(stressService.updatePlan(id, body == null ? JsonNodeFactory.instance.objectNode() : body));
    }

    @DeleteMapping("/api/stress/plans/{id}")
    public ApiResponse<Map<String, Object>> delete(@PathVariable String id) {
        return ApiResponse.ok(stressService.deletePlan(id));
    }

    @GetMapping("/api/stress/plans/{id}")
    public ApiResponse<Map<String, Object>> get(@PathVariable String id) {
        return ApiResponse.ok(stressService.getPlan(id));
    }

    @PostMapping("/api/stress/plans/{id}/run")
    public ApiResponse<Map<String, Object>> run(@PathVariable String id) {
        return ApiResponse.ok(stressService.runPlan(id));
    }

    @PostMapping("/api/stress/plans/{id}/review")
    public ApiResponse<Map<String, Object>> review(@PathVariable String id, @RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactory.instance.objectNode() : body;
        String comment = body.hasNonNull("comment") ? body.get("comment").asText() : null;
        String action = body.hasNonNull("action") ? body.get("action").asText() : null;
        return ApiResponse.ok(stressService.reviewPlan(id, action, comment));
    }

    @GetMapping("/api/stress/runs/{id}")
    public ApiResponse<StressRun> stressRun(@PathVariable String id) {
        return ApiResponse.ok(stressService.getStressRun(id));
    }
}
