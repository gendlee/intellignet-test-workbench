package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.entity.Misc.Config;
import com.boc.apitest.service.ConfigService;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 系統配置（GET/PUT /api/config） */
@RestController
@RequiredArgsConstructor
public class ConfigController {

    private final ConfigService configService;

    @GetMapping("/api/config")
    public ApiResponse<Config> get() {
        return ApiResponse.ok(configService.get());
    }

    @PutMapping("/api/config")
    public ApiResponse<Config> put(@RequestBody(required = false) JsonNode body) {
        return ApiResponse.ok(configService.update(body == null ? com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode() : body));
    }
}
