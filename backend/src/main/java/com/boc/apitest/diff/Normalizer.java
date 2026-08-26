package com.boc.apitest.diff;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.boc.apitest.diff.XmlParser.XmlElement;
import static com.boc.apitest.diff.XmlParser.XmlText;

/**
 * XML / JSON → 統一樹（UIR）→ 拍平為 Map<pathKey, Leaf>。
 * 與 shared/diff/normalize.js 逐行為移植。
 *
 * XML 側約定：
 *   - 屬性 → 鍵 '@attrName'；文字 → 鍵 '#text'（空白文字節點丟棄）
 *   - 重複兄弟標籤 → 陣列；單一標籤 → 單一物件
 *   - 包裝層收斂：非根元素恰好只有一個陣列子鍵 → 直接收斂為該陣列
 *   - 命名空間前綴保留在鍵名中，比較階段可忽略（namespaceInsensitive）
 *
 * 拍平：pathKey 以 '|' 分隔路徑段（段內 '\' 與 '|' 轉義）。
 */
public final class Normalizer {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Normalizer() {}

    /* ---------- 路徑鍵編碼 ---------- */

    public static String encodeSeg(String seg) {
        return seg.replace("\\", "\\\\").replace("|", "\\|");
    }

    public static String decodeSeg(String seg) {
        return seg.replace("\\|", "|").replace("\\\\", "\\");
    }

    public static String encodePath(List<String> segs) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < segs.size(); i++) {
            if (i > 0) sb.append('|');
            sb.append(encodeSeg(segs.get(i)));
        }
        return sb.toString();
    }

    public static List<String> decodePath(String pathKey) {
        List<String> out = new ArrayList<>();
        for (String seg : pathKey.split("\\|")) out.add(decodeSeg(seg));
        return out;
    }

    /* ---------- XML → 樹 ---------- */

    /**
     * @param xmlText        主機報文
     * @param stripNsPrefix  鍵名是否去除命名空間前綴（預設 true）
     * @return 統一樹（根節點即根元素轉換結果）
     */
    public static UniNode xmlToTree(String xmlText, boolean stripNsPrefix) {
        XmlElement dom = XmlParser.parseXML(xmlText);
        return convertElement(dom, stripNsPrefix, true);
    }

    private static UniNode leafOf(Object v) {
        if (v == null) return UniNode.leaf("null", "");
        if (v instanceof Boolean b) return UniNode.leaf("boolean", String.valueOf(b));
        if (v instanceof Number num) return UniNode.leaf("number", String.valueOf(num));
        return UniNode.leaf("string", String.valueOf(v));
    }

    private static String strip(String tag, boolean stripNsPrefix) {
        if (stripNsPrefix) {
            int idx = tag.indexOf(':');
            return idx >= 0 ? tag.substring(idx + 1) : tag;
        }
        return tag;
    }

    private static UniNode convertElement(XmlElement el, boolean stripNsPrefix, boolean isRoot) {
        java.util.Map<String, UniNode> obj = new java.util.LinkedHashMap<>();
        for (Map.Entry<String, String> e : el.attrs.entrySet()) {
            // xmlns 屬性是命名空間宣告而非資料，直接丟棄
            String k = e.getKey();
            if (k.equals("xmlns") || k.startsWith("xmlns:")) continue;
            obj.put("@" + strip(k, stripNsPrefix), leafOf(e.getValue()));
        }

        List<Object> elChildren = new ArrayList<>();
        List<String> textParts = new ArrayList<>();
        for (Object c : el.children) {
            if (c instanceof XmlElement) elChildren.add(c);
            else if (c instanceof XmlText t && !t.text.trim().isEmpty()) textParts.add(t.text);
        }

        // 純文字元素（無子元素、無屬性）→ 直接 leaf
        if (elChildren.isEmpty()) {
            String text = String.join("", textParts).trim();
            if (obj.isEmpty()) return leafOf(text);
            if (!text.isEmpty()) obj.put("#text", leafOf(text));
            UniNode n = UniNode.obj();
            n.children.putAll(obj);
            return n;
        }

        // 子元素分組：重複標籤 → 陣列；單一 → 單一
        Map<String, List<UniNode>> grouped = new java.util.LinkedHashMap<>();
        for (Object c : elChildren) {
            String key = strip(((XmlElement) c).tag, stripNsPrefix);
            grouped.computeIfAbsent(key, k -> new ArrayList<>()).add(convertElement((XmlElement) c, stripNsPrefix, false));
        }
        for (Map.Entry<String, List<UniNode>> g : grouped.entrySet()) {
            List<UniNode> items = g.getValue();
            if (items.size() == 1) obj.put(g.getKey(), items.get(0));
            else {
                UniNode arr = new UniNode();
                arr.kind = UniNode.Kind.ARR;
                arr.items = items;
                obj.put(g.getKey(), arr);
            }
        }
        String text = String.join("", textParts).trim();
        if (!text.isEmpty()) obj.put("#text", leafOf(text));

        // 包裝層收斂：obj 恰好只有一個子鍵且為陣列 → 直接收斂為該陣列
        if (!isRoot && obj.size() == 1) {
            Map.Entry<String, UniNode> only = obj.entrySet().iterator().next();
            if (only.getValue().kind == UniNode.Kind.ARR) return only.getValue();
        }
        UniNode n = UniNode.obj();
        n.children.putAll(obj);
        return n;
    }

    /* ---------- JSON → 樹 ---------- */

    public static UniNode jsonToTree(String jsonText) {
        JsonNode value;
        try {
            value = MAPPER.readTree(jsonText);
        } catch (Exception e) {
            throw new IllegalArgumentException("JSON 解析失敗：" + e.getMessage());
        }
        return convertJson(value);
    }

    private static UniNode convertJson(JsonNode v) {
        if (v == null || v.isNull()) return UniNode.leaf("null", "");
        if (v.isArray()) {
            UniNode arr = new UniNode();
            arr.kind = UniNode.Kind.ARR;
            arr.items = new ArrayList<>();
            for (JsonNode it : v) arr.items.add(convertJson(it));
            return arr;
        }
        if (v.isObject()) {
            UniNode n = UniNode.obj();
            v.fields().forEachRemaining(e -> n.children.put(e.getKey(), convertJson(e.getValue())));
            return n;
        }
        if (v.isNumber()) return UniNode.leaf("number", v.asText());
        if (v.isBoolean()) return UniNode.leaf("boolean", String.valueOf(v.asBoolean()));
        return UniNode.leaf("string", v.asText());
    }

    /* ---------- 拍平 ---------- */

    /**
     * 樹 → Map<pathKey, Leaf>。空 segs 起拍（根節點不在路徑中）。
     * collapseSingle 為 true 時，長度 1 的陣列視同其唯一元素（對稱規則，XML/JSON 皆適用）。
     */
    public static Map<String, UniNode> flatten(UniNode tree, boolean collapseSingle) {
        Map<String, UniNode> map = new java.util.LinkedHashMap<>();
        walk(tree, new ArrayList<>(), map, collapseSingle);
        return map;
    }

    private static void walk(UniNode node, List<String> segs, Map<String, UniNode> map, boolean collapseSingle) {
        if (node.kind == UniNode.Kind.LEAF) {
            map.put(encodePath(segs), node);
            return;
        }
        if (node.kind == UniNode.Kind.ARR) {
            if (collapseSingle && node.items.size() == 1) {
                walk(node.items.get(0), segs, map, collapseSingle);
                return;
            }
            for (int idx = 0; idx < node.items.size(); idx++) {
                List<String> next = new ArrayList<>(segs);
                next.add(String.valueOf(idx));
                walk(node.items.get(idx), next, map, collapseSingle);
            }
            return;
        }
        for (Map.Entry<String, UniNode> e : node.children.entrySet()) {
            List<String> next = new ArrayList<>(segs);
            next.add(e.getKey());
            walk(e.getValue(), next, map, collapseSingle);
        }
    }

    /** 顯示用路徑：data.items[0].amount */
    public static String displayPath(List<String> segs) {
        StringBuilder out = new StringBuilder();
        for (String s : segs) {
            if (s.matches("\\d+")) out.append('[').append(s).append(']');
            else {
                if (out.length() > 0) out.append('.');
                out.append(s);
            }
        }
        return out.toString();
    }
}
