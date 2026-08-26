package com.boc.apitest.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.boc.apitest.diff.Comparators.DiffRules;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.util.List;

/** 其餘實體：模組 / 案例類型 / 版本號 / 系統 / 審核記錄 / 系統配置 / 元資料 */
public final class Misc {

    private Misc() {}

    @Data
    @TableName("modules")
    public static class Module {
        @TableId(type = IdType.INPUT)
        private String id;
        private String name;
        private String code;
        private String description;
        private String createdAt;
        @TableField(exist = false)
        private int caseCount;
    }

    @Data
    @TableName("case_types")
    public static class CaseType {
        @TableId(type = IdType.INPUT)
        private String id;
        private String name;
        private String description;
        private String createdAt;
        @TableField(exist = false)
        private int caseCount;
    }

    @Data
    @TableName("versions")
    public static class Version {
        @TableId(type = IdType.INPUT)
        private String id;
        private String code;      // YYYYMM + A/Z
        private String month;
        private String mode;      // A（集中版本）| Z（非集中版本）
        private String modeLabel;
        private String createdAt;
        // 統計欄位（GET 時計算）
        @TableField(exist = false)
        private long runCount;
        @TableField(exist = false)
        private long executedCaseCount;
        @TableField(exist = false)
        private long linkedCaseCount;
        @TableField(exist = false)
        private long caseCount;
    }

    @Data
    @TableName("systems")
    public static class SystemRec {
        @TableId(type = IdType.INPUT)
        private String id;
        private String name;
        private Boolean active;
        private Boolean readOnly;
    }

    @Data
    @TableName("audit_logs")
    public static class AuditLog {
        @TableId(type = IdType.INPUT)
        private String id;
        private String caseId;
        private String action;   // create | approve | reject | update
        // from/to 為 SQL 保留字（H2/MySQL 均然），欄位名避開、JSON 輸出保持契約
        @TableField("from_status")
        @com.fasterxml.jackson.annotation.JsonProperty("from")
        private String fromStatus;
        @TableField("to_status")
        @com.fasterxml.jackson.annotation.JsonProperty("to")
        private String toStatus;
        private String operator;
        private String at;
        private String comment;
    }

    @Data
    @TableName(value = "config", autoResultMap = true)
    public static class Config {
        @TableId(type = IdType.INPUT)
        private String id;
        private String systemId;
        private Boolean readOnly;
        @TableField(typeHandler = JacksonTypeHandler.class)
        private List<UrlTemplateSeg> urlTemplate;
        @TableField(typeHandler = JacksonTypeHandler.class)
        private List<Env> environments;
        @TableField(typeHandler = JacksonTypeHandler.class)
        private List<Case.HeaderDef> defaultHeaders;
        @TableField(typeHandler = JacksonTypeHandler.class)
        private DiffRules diffRules;
        @TableField(typeHandler = JacksonTypeHandler.class)
        private AiConfig ai;

        @Data
        public static class UrlTemplateSeg {
            private String kind;    // fixed | var
            private String value;
        }

        @Data
        public static class Env {
            private String id;
            private String name;
            private String baseUrl;
            private Boolean current;
        }

        @Data
        public static class AiConfig {
            private Boolean enabled;
            private String mode;     // mock | remote
            private String apiBase;
            private String model;
            private String apiKey;
        }
    }

    @Data
    @TableName("meta")
    public static class Meta {
        @TableId(type = IdType.INPUT)
        private String id;
        private String payload;   // JSON：{ currentUser, currentSystem, features }
    }

    @Data
    public static class UserInfo {
        private String id;
        private String name;
        private String role;
    }

    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Features {
        private Boolean aiGenerate;
        private Boolean capture;
        private Boolean stress;
        private Boolean multiSystem;
    }
}
