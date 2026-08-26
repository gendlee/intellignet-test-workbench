package com.boc.apitest.diff;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 統一中間表示（UIR）——與 shared/diff/normalize.js 的樹結構一致：
 *   OBJ: children Map<key, node>
 *   ARR: items
 *   LEAF: leaf（type: string|number|boolean|null；raw 為字串化值）
 */
public final class UniNode {
    public enum Kind { OBJ, ARR, LEAF }

    public Kind kind;
    public Map<String, UniNode> children; // OBJ
    public List<UniNode> items;           // ARR
    public Leaf leaf;                     // LEAF

    public static UniNode obj() {
        UniNode n = new UniNode();
        n.kind = Kind.OBJ;
        n.children = new LinkedHashMap<>();
        return n;
    }

    public static UniNode leaf(String type, String raw) {
        UniNode n = new UniNode();
        n.kind = Kind.LEAF;
        n.leaf = new Leaf(type, raw);
        return n;
    }
}
