package com.boc.apitest.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 模擬 API 延遲（對齊 server.js apiDelay，保持演示節奏一致）：
 * - /ai-generate → 1200ms
 * - 含 /run → 1500–3000ms
 * - /batch-runs（POST 建立）→ 300ms
 * - 其餘查詢 → 80–200ms
 */
@Component
@ConfigurationProperties(prefix = "app.delay-ms")
public class SimulatedDelayFilter extends OncePerRequestFilter {

    /** 是否啟用（app.delay.enabled） */
    private boolean enabled = true;

    private int aiGenerate = 1200;
    private int run = 1500;
    private int runJitter = 1500;
    private int batch = 300;
    private int queryMin = 80;
    private int queryMax = 200;

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public void setAiGenerate(int aiGenerate) {
        this.aiGenerate = aiGenerate;
    }

    public void setRun(int run) {
        this.run = run;
    }

    public void setRunJitter(int runJitter) {
        this.runJitter = runJitter;
    }

    public void setBatch(int batch) {
        this.batch = batch;
    }

    public void setQueryMin(int queryMin) {
        this.queryMin = queryMin;
    }

    public void setQueryMax(int queryMax) {
        this.queryMax = queryMax;
    }

    public boolean isEnabled() {
        return enabled;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long delay = delayFor(request.getRequestURI());
        if (delay > 0) {
            try {
                Thread.sleep(delay);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        chain.doFilter(request, response);
    }

    long delayFor(String uri) {
        if (!enabled) return 0;
        if (uri.contains("/ai-generate")) return aiGenerate;
        if (uri.contains("/run")) return run + ThreadLocalRandom.current().nextInt(runJitter);
        if (uri.endsWith("/batch-runs") || uri.contains("/batch-runs/")) return batch;
        return queryMin + ThreadLocalRandom.current().nextInt(queryMax - queryMin + 1);
    }
}
