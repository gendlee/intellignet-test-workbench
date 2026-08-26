package com.boc.apitest.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 批量回歸批次：running → done；caseResults[].status: pending → PASS|DIFF|FAIL */
@Data
@TableName(value = "batch_runs", autoResultMap = true)
public class BatchRun {

    @TableId(type = IdType.INPUT)
    private String id;
    private String name;
    private String version;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> caseIds = new ArrayList<>();

    private String status;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Progress progress;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<CaseResult> caseResults = new ArrayList<>();

    private String runBy;
    private String startedAt;
    private String finishedAt;

    @Data
    public static class Progress {
        private int total;
        private int finished;
        private int pass;
        private int diff;
        private int fail;
    }

    @Data
    public static class CaseResult {
        private String caseId;
        private String txnCode;
        private String status;
    }
}
