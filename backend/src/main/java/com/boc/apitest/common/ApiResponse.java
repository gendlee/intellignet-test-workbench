package com.boc.apitest.common;

import lombok.AllArgsConstructor;
import lombok.Data;

/**
 * 統一響應包裹（對齊 docs/API-LIST.md 契約）：{ code, message, data }，code !== 0 為錯誤。
 */
@Data
@AllArgsConstructor
public class ApiResponse<T> {
    private int code;
    private String message;
    private T data;

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(0, "ok", data);
    }

    public static ApiResponse<Void> error(int code, String message) {
        return new ApiResponse<>(code, message, null);
    }
}
