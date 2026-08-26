package com.boc.apitest.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.util.List;

/** 壓測計劃狀態機：pending → approved|rejected → running → done */
@Data
@TableName(value = "stress_plans", autoResultMap = true)
public class StressPlan {

    @TableId(type = IdType.INPUT)
    private String id;
    private String name;
    private String method;
    private String url;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Case.HeaderDef> headers;

    private String body;
    private Integer concurrency;
    private Integer durationSec;
    private Integer rampUpSec;
    private String status;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Case.Review review;

    private Integer runCount;
    private String createdBy;
    private String createdAt;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private StressRun lastRun;
}
