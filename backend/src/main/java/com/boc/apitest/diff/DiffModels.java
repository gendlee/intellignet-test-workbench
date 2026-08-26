package com.boc.apitest.diff;

import lombok.Data;

import java.util.List;
import java.util.Map;

/** diff 結果模型（對齊 docs/API-LIST.md 的 run.diff 結構；同時作為 runs 表的 JSON 欄位） */
public final class DiffModels {

    private DiffModels() {}

    @Data
    public static class DiffItem {
        private List<String> path;
        private String kind;            // added | deleted | modified
        private String hostValue;       // null 表示無
        private String newValue;
        private String plausibility;    // FORMAT | STRUCTURAL | DATA
        private String suspicion;       // low | medium | high
        private boolean precisionRisk;
        private String reason;
    }

    @Data
    public static class DiffSummary {
        private int total;
        private int added;
        private int deleted;
        private int modified;
        private int low;
        private int medium;
        private int high;
    }

    @Data
    public static class DiffResult {
        private DiffSummary summary;
        private List<DiffItem> items;
        private String verdict;         // PASS | DIFF | FAIL
        private String stateType;
        private Map<String, String> meta;
    }
}
