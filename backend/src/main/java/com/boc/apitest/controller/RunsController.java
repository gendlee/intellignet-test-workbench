package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.entity.Run;
import com.boc.apitest.mapper.Mappers.RunMapper;
import com.boc.apitest.common.BizException;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** 運行記錄詳情（GET /api/runs/{id}） */
@RestController
@RequiredArgsConstructor
public class RunsController {

    private final RunMapper runMapper;

    @GetMapping("/api/runs/{id}")
    public ApiResponse<Run> get(@PathVariable String id) {
        Run r = runMapper.selectById(id);
        if (r == null) throw new BizException(4040, "運行記錄不存在");
        return ApiResponse.ok(r);
    }
}
