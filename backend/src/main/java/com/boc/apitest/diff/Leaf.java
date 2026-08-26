package com.boc.apitest.diff;

/** 葉節點：type（string|number|boolean|null）+ raw（字串化原始值） */
public final class Leaf {
    public String type;
    public String raw;

    public Leaf() {}

    public Leaf(String type, String raw) {
        this.type = type;
        this.raw = raw;
    }
}
