package com.boc.apitest;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 中銀香港智能化API測試工作台 — 後端（Java 17 / Spring Boot 3.3.5 / MyBatis-Plus）。
 * 與前端 mock 服務逐端點對齊（docs/API-LIST.md）。
 */
@SpringBootApplication
@MapperScan("com.boc.apitest.mapper")
public class ApiTestApplication {

    public static void main(String[] args) {
        SpringApplication.run(ApiTestApplication.class, args);
    }
}
