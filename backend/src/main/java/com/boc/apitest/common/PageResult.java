package com.boc.apitest.common;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

/** 分頁形狀（對齊契約）：{ list, total, page, pageSize } */
@Data
@AllArgsConstructor
public class PageResult<T> {
    private List<T> list;
    private long total;
    private int page;
    private int pageSize;

    /** 對齊 mock/db.js paginate()：pageSize 夾在 [1,100]，越界時截斷 */
    public static <T> PageResult<T> paginate(List<T> list, String pageRaw, String pageSizeRaw) {
        int page = Math.max(1, parse(pageRaw, 1));
        int pageSize = Math.min(100, Math.max(1, parse(pageSizeRaw, 10)));
        int start = (page - 1) * pageSize;
        List<T> slice = start >= list.size() ? List.of() : list.subList(start, Math.min(start + pageSize, list.size()));
        return new PageResult<>(slice, list.size(), page, pageSize);
    }

    private static int parse(String s, int def) {
        if (s == null || s.isBlank()) return def;
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }
}
