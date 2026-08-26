package com.boc.apitest.common;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** ISO-8601 UTC 時間工具：一律輸出 "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"（與 mock toISOString 一致） */
public final class TimeUtil {
    public static final DateTimeFormatter ISO_UTC = DateTimeFormatter
            .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
            .withZone(ZoneOffset.UTC);

    private TimeUtil() {}

    public static String now() {
        return ISO_UTC.format(Instant.now());
    }

    public static String iso(Instant instant) {
        return ISO_UTC.format(instant);
    }

    /** "2026-08-26T03:30:00.000Z" → epoch millis；非法回傳 null */
    public static Long epochMillis(String isoUtc) {
        if (isoUtc == null || isoUtc.isBlank()) return null;
        try {
            return Instant.parse(isoUtc).toEpochMilli();
        } catch (Exception e) {
            return null;
        }
    }

    /** epoch millis → ISO UTC 字串 */
    public static String fromMillis(long millis) {
        return ISO_UTC.format(Instant.ofEpochMilli(millis));
    }
}
