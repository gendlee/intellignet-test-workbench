package com.boc.apitest.service;

import org.springframework.stereotype.Component;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;

/**
 * 共享定時執行器：批量運行（每 700ms 一條）與壓測模擬（1.6s 後完成）共用。
 * 對齊 mock/routes.js 的 setInterval / setTimeout 語義（輕量單例，多線程安全足夠）。
 */
@Component
public class AsyncRunner {

    private final ScheduledExecutorService executor = Executors.newScheduledThreadPool(2);

    public ScheduledExecutorService executor() {
        return executor;
    }
}
