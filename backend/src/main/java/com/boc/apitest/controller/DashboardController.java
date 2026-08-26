package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.service.DashboardService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 儀表盤（summary / recent-runs / pending-reviews / charts） */
@RestController
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    @GetMapping("/api/dashboard/summary")
    public ApiResponse<Map<String, Object>> summary() {
        return ApiResponse.ok(dashboardService.summary());
    }

    @GetMapping("/api/dashboard/recent-runs")
    public ApiResponse<List<Map<String, Object>>> recentRuns(@RequestParam(required = false, defaultValue = "10") Integer limit) {
        return ApiResponse.ok(dashboardService.recentRuns(limit));
    }

    @GetMapping("/api/dashboard/pending-reviews")
    public ApiResponse<List<Map<String, Object>>> pendingReviews(@RequestParam(required = false, defaultValue = "10") Integer limit) {
        return ApiResponse.ok(dashboardService.pendingReviews(limit));
    }

    @GetMapping("/api/dashboard/charts")
    public ApiResponse<Object> charts(@RequestParam String type) {
        return ApiResponse.ok(dashboardService.charts(type));
    }
}
