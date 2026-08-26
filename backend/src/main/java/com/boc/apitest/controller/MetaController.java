package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.entity.Misc.Meta;
import com.boc.apitest.entity.Misc.SystemRec;
import com.boc.apitest.service.MetaService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 元數據（GET /api/meta/context、GET /api/systems） */
@RestController
@RequiredArgsConstructor
public class MetaController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final MetaService metaService;

    @GetMapping("/api/meta/context")
    public ApiResponse<ObjectNode> context() {
        return ApiResponse.ok(metaService.getContext());
    }

    @GetMapping("/api/systems")
    public ApiResponse<List<SystemRec>> systems() {
        return ApiResponse.ok(metaService.listSystems());
    }
}
