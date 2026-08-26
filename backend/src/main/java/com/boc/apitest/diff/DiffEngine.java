package com.boc.apitest.diff;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

import static com.boc.apitest.diff.Comparators.DiffRules;
import static com.boc.apitest.diff.DiffModels.DiffItem;
import static com.boc.apitest.diff.DiffModels.DiffResult;
import static com.boc.apitest.diff.DiffModels.DiffSummary;
import static com.boc.apitest.diff.Normalizer.decodeSeg;
import static com.boc.apitest.diff.Normalizer.encodePath;

/**
 * diff 主入口：compare(hostText, newText, opts) → DiffResult。
 *
 * 流程：解析（XML/JSON）→ 統一樹 → 拍平 Map<pathKey, Leaf>
 *     → 過濾（wrapIgnoreKeys / ignoreFields / dynamicRegex / attrMerge）
 *     → 陣列對齊（key 模式）→ 逐鍵比較 → 合理性分級 → DiffResult
 *
 * 與 shared/diff/diff.js 逐行為移植，保證「執行結果口徑 = 前端展示口徑」。
 */
public final class DiffEngine {

    private DiffEngine() {}

    /**
     * 陣列主鍵對齊（arrayMatchMode='key'）：把 new 側陣列重排，使主鍵相同的元素與
     * host 側索引對齊（剩餘元素保持原序；host 有而 new 無的位置以空物件佔位）。
     */
    static void alignArraysByKey(UniNode hostTree, UniNode newTree, Map<String, String> matchKeys, List<String> prefix) {
        String pathStr = encodePath(prefix);
        String matchKey = matchKeys.get(pathStr);
        if (matchKey != null && hostTree.kind == UniNode.Kind.ARR && newTree.kind == UniNode.Kind.ARR) {
            Map<String, Integer> indexByKey = new LinkedHashMap<>();
            for (int i = 0; i < hostTree.items.size(); i++) {
                String k = keyOf(hostTree.items.get(i), matchKey);
                if (k != null) indexByKey.put(k, i);
            }
            UniNode[] reordered = new UniNode[hostTree.items.size()];
            List<UniNode> extra = new ArrayList<>();
            for (UniNode it : newTree.items) {
                String k = keyOf(it, matchKey);
                Integer i = k != null ? indexByKey.get(k) : null;
                if (i != null && reordered[i] == null) reordered[i] = it;
                else extra.add(it);
            }
            for (int i = 0; i < reordered.length; i++) {
                if (reordered[i] == null) reordered[i] = UniNode.obj();
            }
            List<UniNode> merged = new ArrayList<>(List.of(reordered));
            merged.addAll(extra);
            newTree.items = merged;
        }
        if (hostTree.kind == UniNode.Kind.OBJ && newTree.kind == UniNode.Kind.OBJ) {
            for (Map.Entry<String, UniNode> e : hostTree.children.entrySet()) {
                UniNode hv = e.getValue();
                UniNode nv = newTree.children.get(e.getKey());
                if (nv != null) {
                    List<String> next = new ArrayList<>(prefix);
                    next.add(e.getKey());
                    alignArraysByKey(hv, nv, matchKeys, next);
                }
            }
        } else if (hostTree.kind == UniNode.Kind.ARR && newTree.kind == UniNode.Kind.ARR) {
            for (int i = 0; i < hostTree.items.size(); i++) {
                if (i < newTree.items.size()) {
                    List<String> next = new ArrayList<>(prefix);
                    next.add(String.valueOf(i));
                    alignArraysByKey(hostTree.items.get(i), newTree.items.get(i), matchKeys, next);
                }
            }
        }
    }

    private static String keyOf(UniNode node, String matchKey) {
        if (node.kind != UniNode.Kind.OBJ) return null;
        UniNode child = node.children.get(matchKey);
        if (child == null || child.kind != UniNode.Kind.LEAF) return null;
        return child.leaf.raw;
    }

    /** 過濾 + 屬性鍵合併（XML '@a' ↔ JSON 'a'） */
    private static Map<String, UniNode> filterMap(Map<String, UniNode> map, DiffRules rules) {
        Map<String, UniNode> out = new LinkedHashMap<>();
        for (Map.Entry<String, UniNode> e : map.entrySet()) {
            String pathKey = e.getKey();
            String[] segs = pathKey.split("\\|", -1);
            List<String> rawSegs = new ArrayList<>();
            for (String s : segs) rawSegs.add(decodeSeg(s));
            String last = rawSegs.get(rawSegs.size() - 1);

            // 包裝鍵（第一段，如 code/msg/status/requestId）：不參與 diff
            if (rules.wrapIgnoreKeys.contains(rawSegs.get(0))) continue;
            // 精確忽略欄位
            if (rules.ignoreFields.contains(last)) continue;
            // 動態欄位正則
            boolean ignored = false;
            for (String re : rules.dynamicRegex) {
                try {
                    if (Pattern.compile(re).matcher(last).find()) {
                        ignored = true;
                        break;
                    }
                } catch (Exception ignore) {
                    /* 非法正則忽略 */
                }
            }
            if (ignored) continue;

            // 屬性鍵合併：'@a' → 'a'（與 JSON 的 'a' 對齊）
            if (rules.attrMerge && last.startsWith("@")) {
                segs[segs.length - 1] = last.substring(1);
                out.put(String.join("|", segs), e.getValue());
            } else {
                out.put(pathKey, e.getValue());
            }
        }
        return out;
    }

    private static DiffResult buildResult(Map<String, UniNode> fHost, Map<String, UniNode> fNew,
                                          DiffRules rules, String stateType, Map<String, String> extraMeta) {
        List<DiffItem> items = new ArrayList<>();
        Set<String> all = new TreeSet<>(fHost.keySet());
        all.addAll(fNew.keySet());

        for (String k : all) {
            UniNode h = fHost.get(k);
            UniNode n = fNew.get(k);
            List<String> segs = Normalizer.decodePath(k);
            if (h != null && n != null) {
                Comparators.CompareOutcome r = Comparators.compareValues(h.leaf, n.leaf, rules);
                // 實質差異（!equal）或資訊性表示差異都要輸出——永不靜默吞掉差異
                if (!r.equal || r.informational) {
                    DiffItem item = new DiffItem();
                    item.setPath(segs);
                    item.setKind("modified");
                    item.setHostValue(h.leaf.raw);
                    item.setNewValue(n.leaf.raw);
                    item.setPlausibility(r.plausibility);
                    item.setSuspicion(Comparators.suspicionOf(r.plausibility, stateType));
                    item.setPrecisionRisk(r.precisionRisk);
                    item.setReason(r.reason);
                    items.add(item);
                }
            } else if (h != null) {
                DiffItem item = new DiffItem();
                item.setPath(segs);
                item.setKind("deleted");
                item.setHostValue(h.leaf.raw);
                item.setPlausibility("STRUCTURAL");
                item.setSuspicion(Comparators.suspicionOf("STRUCTURAL", stateType));
                item.setPrecisionRisk(false);
                item.setReason(Comparators.suspicionReason("STRUCTURAL", stateType));
                items.add(item);
            } else {
                DiffItem item = new DiffItem();
                item.setPath(segs);
                item.setKind("added");
                item.setNewValue(n.leaf.raw);
                item.setPlausibility("STRUCTURAL");
                item.setSuspicion(Comparators.suspicionOf("STRUCTURAL", stateType));
                item.setPrecisionRisk(false);
                item.setReason(Comparators.suspicionReason("STRUCTURAL", stateType));
                items.add(item);
            }
        }

        items.sort((a, b) -> String.join("|", a.getPath()).compareTo(String.join("|", b.getPath())));

        DiffSummary summary = new DiffSummary();
        summary.setTotal(items.size());
        for (DiffItem i : items) {
            switch (i.getKind()) {
                case "added" -> summary.setAdded(summary.getAdded() + 1);
                case "deleted" -> summary.setDeleted(summary.getDeleted() + 1);
                default -> summary.setModified(summary.getModified() + 1);
            }
            switch (i.getSuspicion()) {
                case "low" -> summary.setLow(summary.getLow() + 1);
                case "medium" -> summary.setMedium(summary.getMedium() + 1);
                default -> summary.setHigh(summary.getHigh() + 1);
            }
        }

        // 判決：無差異 → PASS；存在高可疑 → FAIL；其餘（僅低/中可疑）→ DIFF
        String verdict = summary.getTotal() == 0 ? "PASS" : summary.getHigh() > 0 ? "FAIL" : "DIFF";

        DiffResult result = new DiffResult();
        result.setSummary(summary);
        result.setItems(items);
        result.setVerdict(verdict);
        result.setStateType(stateType);
        result.setMeta(extraMeta);
        return result;
    }

    /**
     * 主入口：比較主機系統輸出（XML）與微服務系統輸出（JSON）。
     *
     * @param hostText  主機報文
     * @param newText   微服務系統報文
     * @param rules     比較規則（null → DEFAULT_RULES）
     * @param stateType 'STATELESS' | 'STATEFUL'
     * @param extraMeta 附加到結果 meta（stateNote / caseName / txnCode）
     * @return DiffResult { summary, items, verdict, stateType, meta }
     * @throws IllegalArgumentException 任一端解析失敗（訊息與 mock 一致）
     */
    public static DiffResult compare(String hostText, String newText, DiffRules rules, String stateType,
                                     Map<String, String> extraMeta) {
        DiffRules merged = new DiffRules();
        if (rules != null) {
            merged.arrayMatchMode = rules.arrayMatchMode;
            merged.arrayMatchKeys = rules.arrayMatchKeys;
            merged.ignoreFields = rules.ignoreFields;
            merged.dynamicRegex = rules.dynamicRegex;
            merged.numeric = rules.numeric;
            merged.numericTolerance = rules.numericTolerance;
            merged.longNumberGuard = rules.longNumberGuard;
            merged.timeNormalize = rules.timeNormalize;
            merged.collapseSingleArray = rules.collapseSingleArray;
            merged.attrMerge = rules.attrMerge;
            merged.namespaceInsensitive = rules.namespaceInsensitive;
            merged.emptyEqualsNull = rules.emptyEqualsNull;
            merged.wrapIgnoreKeys = rules.wrapIgnoreKeys;
        }
        String st = "STATEFUL".equals(stateType) ? "STATEFUL" : "STATELESS";

        UniNode hostTree, newTree;
        try {
            hostTree = Normalizer.xmlToTree(hostText, merged.namespaceInsensitive);
        } catch (Exception e) {
            throw new IllegalArgumentException("主機報文解析失敗：" + e.getMessage());
        }
        try {
            newTree = Normalizer.jsonToTree(newText);
        } catch (Exception e) {
            throw new IllegalArgumentException("微服務系統報文解析失敗：" + e.getMessage());
        }

        if ("key".equals(merged.arrayMatchMode)) {
            alignArraysByKey(hostTree, newTree, merged.arrayMatchKeys, new ArrayList<>());
        }

        Map<String, UniNode> hostMap = Normalizer.flatten(hostTree, merged.collapseSingleArray);
        Map<String, UniNode> newMap = Normalizer.flatten(newTree, merged.collapseSingleArray);

        Map<String, UniNode> fHost = filterMap(hostMap, merged);
        Map<String, UniNode> fNew = filterMap(newMap, merged);
        return buildResult(fHost, fNew, merged, st, extraMeta);
    }
}
