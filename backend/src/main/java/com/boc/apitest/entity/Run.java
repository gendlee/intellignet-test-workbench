package com.boc.apitest.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.boc.apitest.diff.DiffModels.DiffResult;
import lombok.Data;

import java.util.List;

/** 運行記錄（單條/批量），含完整 diff / steps，供詳情頁與 Word 導出 */
@Data
@TableName(value = "runs", autoResultMap = true)
public class Run {

    @TableId(type = IdType.INPUT)
    private String id;
    private String caseId;
    private String batchId;    // BATCH 執行時為批次 id
    private String type;       // SINGLE | BATCH
    private String version;    // 執行時選擇的版本號（可空）
    private String caseType;   // 執行結果體現案例類型
    private String testType;   // 執行結果體現測試類型（SIT/UAT）

    @TableField(typeHandler = JacksonTypeHandler.class)
    private InputSnapshot inputSnapshot;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private HttpResult hostResult;   // compare 模式：主機（XML）側

    @TableField(typeHandler = JacksonTypeHandler.class)
    private HttpResult newResult;    // 微服務系統側 / http 模式唯一結果

    @TableField(typeHandler = JacksonTypeHandler.class)
    private DiffResult diff;         // compare 模式才有；http 模式為 null

    private String verdict;          // PASS | DIFF | FAIL
    private String stateNote;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Step> steps;        // 執行過程步驟（詳情頁時間線）

    private String runBy;
    private String startedAt;
    private String finishedAt;

    @Data
    public static class InputSnapshot {
        private String hostXml;
        private Case.NewInput newInput;
    }

    @Data
    public static class HttpResult {
        private Integer httpStatus;
        private Integer latencyMs;
        private String rawBody;
    }

    @Data
    public static class Step {
        private String name;
        private String status;   // ok | warn | fail
        private Integer ms;
        private String detail;
    }
}
