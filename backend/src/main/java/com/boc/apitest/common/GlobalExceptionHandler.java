package com.boc.apitest.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 錯誤響應：HTTP 狀態對齊 mock（4040→404，其餘業務錯誤→400），
 * body 一律 { code, message }。前端 api.js 只認 code，HTTP 狀態僅為輔助。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e) {
        HttpStatus status = e.getCode() == 4040 ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
        return ResponseEntity.status(status).body(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleBadJson(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(ApiResponse.error(4000, "請求體 JSON 解析失敗"));
    }

    /**
     * 未映射路徑（如誤開 http://localhost:8081/）：返回 404 JSON 而非 500。
     * 前端頁面/靜態資源由前端伺服器（8080，npm start）提供。
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNoResource(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(4040, "後端僅提供 /api/* 接口，頁面請經前端伺服器（npm start → http://localhost:8080）訪問"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleOther(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error(5000, "伺服器錯誤：" + e.getMessage()));
    }
}
