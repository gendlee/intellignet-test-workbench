package com.boc.apitest.service;

import com.boc.apitest.mapper.Mappers.SeqMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 全局自增序（對齊 mock/db.js nextId）：
 * 所有集合共用一個計數器；id = 前綴 + 4 位補零序號。
 * 前綴映射：cases→C、runs→R、stressPlans→SP、versions→V、modules→M、
 *           caseTypes→CT、其餘（batchRuns / stressRuns）→SR。
 */
@Service
@RequiredArgsConstructor
public class SeqService {

    public static final String PREFIX_CASE = "C";
    public static final String PREFIX_RUN = "R";
    public static final String PREFIX_PLAN = "SP";
    public static final String PREFIX_VERSION = "V";
    public static final String PREFIX_MODULE = "M";
    public static final String PREFIX_CASE_TYPE = "CT";
    public static final String PREFIX_SR = "SR"; // batchRuns / stressRuns

    private final SeqMapper seqMapper;
    private final Object lock = new Object();

    public String nextId(String prefix) {
        synchronized (lock) {
            Long cur = seqMapper.selectNextVal("global");
            long val = cur == null ? 1 : cur + 1;
            if (cur == null) seqMapper.insertRow("global", val);
            else seqMapper.updateNextVal("global", val);
            return prefix + String.format("%04d", val);
        }
    }
}
