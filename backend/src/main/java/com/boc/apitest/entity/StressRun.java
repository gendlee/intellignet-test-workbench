package com.boc.apitest.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.util.List;

/** 壓測運行結果：summary（tps/延遲分位/錯誤率）+ series（每秒採樣點） */
@Data
@TableName(value = "stress_runs", autoResultMap = true)
public class StressRun {

    @TableId(type = IdType.INPUT)
    private String id;
    private String planId;
    private String status;
    private String startedAt;
    private String finishedAt;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Summary summary;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Point> series;

    @Data
    public static class Summary {
        private int tps;
        private int avgLatencyMs;
        private int p50;
        private int p90;
        private int p95;
        private int p99;
        private double errorRate;
        private int totalRequests;
    }

    @Data
    public static class Point {
        private int tSec;
        private int tps;
        private double errorRate;
        private int latencyP50;
    }
}
