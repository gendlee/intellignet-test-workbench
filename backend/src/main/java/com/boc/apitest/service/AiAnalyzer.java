package com.boc.apitest.service;

import com.boc.apitest.diff.DiffModels.DiffItem;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Run;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 初步分析（mock/ai-analyzer.js 的規則引擎移植）。
 * 未成功（DIFF / FAIL）運行 → 基於 diff 明細與 HTTP 結果歸納結構化原因。
 * 前端只展示「僅供參考」的初步分析，判定仍以字段級比對為準。
 */
@Service
public class AiAnalyzer {

    static final String DISCLAIMER = "AI 初步分析僅供參考，請以字段級比對結果為準";

    private static String escV(String v) {
        String s = v == null ? "" : v;
        return s.length() > 46 ? s.substring(0, 46) + "…" : s;
    }

    private static final Pattern JSON_ERR_RE = Pattern.compile(
            "\\\"?(?:error|errorMessage|message|reason|description|errMsg)\\\"?\\s*[:=]\\s*\\\"([^\\\"]+)\\\"",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern XML_ERR_RE = Pattern.compile(
            "<(?:Error|Fault|Reason|Description)[^>]*>([^<]+)</", Pattern.CASE_INSENSITIVE);

    /** 從原始報文中粗提取錯誤信息（JSON error/message / XML Error 標籤） */
    static String extractErrorSnippet(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        Matcher m = JSON_ERR_RE.matcher(raw);
        if (m.find()) return m.group(1);
        Matcher x = XML_ERR_RE.matcher(raw);
        if (x.find()) return x.group(1).trim();
        return raw.length() > 120 ? raw.substring(0, 120) : raw;
    }

    private static String path(DiffItem i) {
        return String.join(".", i.getPath());
    }

    /** DIFF 模式：基於字段級比對明細歸納 */
    private Map<String, Object> analyzeDiff(Run run) {
        List<DiffItem> items = run.getDiff() == null ? List.of() : run.getDiff().getItems();
        List<DiffItem> add = new ArrayList<>();
        List<DiffItem> del = new ArrayList<>();
        List<DiffItem> mod = new ArrayList<>();
        List<DiffItem> risk = new ArrayList<>();
        for (DiffItem i : items) {
            if ("added".equals(i.getKind())) add.add(i);
            else if ("deleted".equals(i.getKind())) del.add(i);
            else if ("modified".equals(i.getKind())) mod.add(i);
            if (i.isPrecisionRisk()) risk.add(i);
        }

        List<Map<String, String>> reasons = new ArrayList<>();
        if (!add.isEmpty()) {
            List<String> names = new ArrayList<>();
            for (int i = 0; i < Math.min(4, add.size()); i++) names.add(path(add.get(i)));
            reasons.add(reason("warn", "微服務系統較主機多出欄位：" + String.join("、", names)
                    + (add.size() > 4 ? " 等 " + add.size() + " 個" : "") + "（可能為介面升級或欄位映射差異）"));
        }
        if (!del.isEmpty()) {
            List<String> names = new ArrayList<>();
            for (int i = 0; i < Math.min(4, del.size()); i++) names.add(path(del.get(i)));
            reasons.add(reason("warn", "微服務系統缺少主機欄位：" + String.join("、", names)
                    + (del.size() > 4 ? " 等 " + del.size() + " 個" : "") + "（需確認欄位是否被下線或映射缺失）"));
        }
        for (int i = 0; i < Math.min(5, mod.size()); i++) {
            DiffItem it = mod.get(i);
            reasons.add(reason("HIGH".equals(it.getSuspicion()) ? "error" : "info",
                    "欄位 " + path(it) + " 值不一致（主機「" + escV(it.getHostValue()) + "」vs 微服務「" + escV(it.getNewValue()) + "」）"));
        }
        if (mod.size() > 5) reasons.add(reason("info", "另有 " + (mod.size() - 5) + " 處修改欄位，詳見下方字段級比對"));
        if (!risk.isEmpty()) {
            List<String> names = new ArrayList<>();
            for (int i = 0; i < Math.min(3, risk.size()); i++) names.add(path(risk.get(i)));
            reasons.add(reason("warn", "長數字欄位 " + String.join("、", names) + " 存在精度風險，建議核對數據庫精度設定"));
        }
        for (String side : new String[]{"hostResult", "newResult"}) {
            Run.HttpResult r = "hostResult".equals(side) ? run.getHostResult() : run.getNewResult();
            if (r != null && r.getHttpStatus() != null && (r.getHttpStatus() < 200 || r.getHttpStatus() >= 300)) {
                reasons.add(reason("error", ("hostResult".equals(side) ? "主機" : "微服務系統")
                        + "返回 HTTP " + r.getHttpStatus() + "，請檢查接口可用性與鑒權"));
            }
        }

        int total = items.size();
        String summary;
        if (total == 0) {
            summary = "兩側報文結構一致，但執行被判為未通過（詳見執行過程）";
        } else {
            summary = "兩側響應存在 " + total + " 處字段差異（" + add.size() + " 增 / " + del.size() + " 刪 / "
                    + mod.size() + " 改），" + (add.size() + del.size() > 0 ? "以結構性差異為主" : "以資料值差異為主");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("summary", summary);
        out.put("reasons", reasons.size() > 8 ? reasons.subList(0, 8) : reasons);
        out.put("confidence", total <= 3 ? "高" : total <= 10 ? "中" : "低");
        out.put("disclaimer", DISCLAIMER);
        out.put("model", "規則引擎（mock）");
        return out;
    }

    private static Map<String, String> reason(String level, String text) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("level", level);
        m.put("text", text);
        return m;
    }

    /** HTTP 模式：基於狀態碼與響應體歸納 */
    private Map<String, Object> analyzeHttp(Run run) {
        Run.HttpResult res = run.getNewResult();
        Integer status = res != null && res.getHttpStatus() != null ? res.getHttpStatus() : null;
        List<Map<String, String>> reasons = new ArrayList<>();
        if (status != null && (status < 200 || status >= 300)) {
            String hint;
            if (status >= 500) hint = "疑似服務端異常";
            else if (status == 404) hint = "接口路徑或方法不存在";
            else if (status == 401 || status == 403) hint = "鑒權失敗，請檢查 API-Key 與權限";
            else hint = "請求被拒絕";
            reasons.add(reason("error", "微服務系統返回 HTTP " + status + "（" + hint + "）"));
        } else if (status != null) {
            reasons.add(reason("warn", "HTTP " + status + " 雖為 2xx，但執行被判失敗，請核對業務結果與響應體"));
        }
        String snip = extractErrorSnippet(res != null ? res.getRawBody() : null);
        if (snip != null) reasons.add(reason("info", "響應錯誤信息：" + escV(snip)));
        if (run.getSteps() != null) {
            for (Run.Step st : run.getSteps()) {
                if ("fail".equals(st.getStatus())) {
                    reasons.add(reason("error", "步驟「" + st.getName() + "」失敗：" + (st.getDetail() == null || st.getDetail().isEmpty() ? "無詳情" : st.getDetail())));
                } else if ("warn".equals(st.getStatus())) {
                    reasons.add(reason("warn", "步驟「" + st.getName() + "」異常：" + (st.getDetail() == null || st.getDetail().isEmpty() ? "無詳情" : st.getDetail())));
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("summary", status != null && status >= 400
                ? "微服務系統接口調用失敗（HTTP " + status + "）"
                : "執行未通過，請結合 HTTP 狀態與響應體定位原因");
        out.put("reasons", reasons.size() > 8 ? reasons.subList(0, 8) : reasons);
        out.put("confidence", reasons.isEmpty() ? "低" : "中");
        out.put("disclaimer", DISCLAIMER);
        out.put("model", "規則引擎（mock）");
        return out;
    }

    public Map<String, Object> analyzeFailure(Run run, Case c) {
        if (run == null || "PASS".equals(run.getVerdict())) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("summary", "執行通過，無需分析");
            out.put("reasons", List.of());
            out.put("confidence", "高");
            out.put("disclaimer", DISCLAIMER);
            out.put("model", "規則引擎（mock）");
            return out;
        }
        return run.getDiff() != null ? analyzeDiff(run) : analyzeHttp(run);
    }
}
