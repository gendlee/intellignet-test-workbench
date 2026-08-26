package com.boc.apitest.common;

import lombok.Getter;

/** 業務錯誤：code 4000（業務）/ 4030（審批約束）/ 4040（未找到），message 與 mock 逐字一致 */
@Getter
public class BizException extends RuntimeException {
    private final int code;

    public BizException(int code, String message) {
        super(message);
        this.code = code;
    }

    public static BizException biz(String message) {
        return new BizException(4000, message);
    }

    public static BizException notFound(String message) {
        return new BizException(4040, message);
    }

    public static BizException forbidden(String message) {
        return new BizException(4030, message);
    }
}
