package com.boc.apitest.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.boc.apitest.diff.DiffEngine;
import com.boc.apitest.entity.Misc.AuditLog;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 測試案例。唯一標識為案例編號（C 開頭 id）；交易碼可維護（允許重複）。
 * versions = 顯式關聯的版本號陣列；lastRun = 最近一次完整運行記錄（與 mock 一致內嵌）。
 */
@Data
@TableName(value = "cases", autoResultMap = true)
public class Case {

    @TableId(type = IdType.INPUT)
    private String id;
    private String txnCode;
    private String name;
    private String systemId;
    private String module;
    private String stateType;    // STATELESS | STATEFUL
    private String status;       // DRAFT | PENDING | APPROVED | REJECTED
    private String precondition;
    private String mode;         // compare | http
    private String hostFormat;   // XML | JSON
    private String profile;      // 差異場景設定檔（seed/新建時 pass）
    private String type;         // 案例類型（引用 case_types 名稱）
    private String testType;     // SIT | UAT

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> versions = new ArrayList<>();

    @TableField(typeHandler = JacksonTypeHandler.class)
    private HostInput hostInput;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private NewInput newInput;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private AiMeta aiMeta;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Review review;

    private String createdBy;
    private String createdAt;
    private String updatedAt;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Run lastRun;

    @TableField(exist = false)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<AuditLog> auditLogs;

    @Data
    public static class HostInput {
        private String rawXml;
    }

    /** AI 生成 / 手工錄入的新系統請求（與 mock newInput 結構一致） */
    @Data
    public static class NewInput {
        private String url;
        private String method;
        private List<HeaderDef> headers;
        private String body;
        private boolean refinedByHuman;
    }

    /** 請求頭定義（defaultHeaders / newInput.headers 共用） */
    @Data
    public static class HeaderDef {
        private String name;
        private String value;
        private Boolean enabled;
        private Boolean secret;
    }

    @Data
    public static class AiMeta {
        private String source;          // ai | manual
        private String generatedAt;
        private boolean refinedByHuman;
    }

    @Data
    public static class Review {
        private String reviewer;
        private String comment;
        private String at;
    }
}
