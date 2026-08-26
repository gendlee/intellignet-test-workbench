package com.boc.apitest.service;

import com.boc.apitest.common.TimeUtil;
import com.boc.apitest.entity.BatchRun;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Run;
import com.boc.apitest.mapper.Mappers.BatchRunMapper;
import com.boc.apitest.mapper.Mappers.CaseMapper;
import com.boc.apitest.mapper.Mappers.RunMapper;
import com.boc.apitest.service.GeneratorService.RunContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 批量回歸（mock/routes.js startBatch 移植）：每 700ms 執行一條，
 * 完成後置 done 並寫 finishedAt。批次內 runIndex 固定為 1。
 */
@Service
@RequiredArgsConstructor
public class BatchRunner {

    private static final long INTERVAL_MS = 700;

    private final AsyncRunner asyncRunner;
    private final CaseMapper caseMapper;
    private final RunMapper runMapper;
    private final BatchRunMapper batchRunMapper;
    private final GeneratorService generatorService;
    private final MetaService metaService;
    private final ConfigService configService;

    public void start(BatchRun batch, List<Case> recs) {
        batch.setStatus("running");
        BatchRun.Progress progress = new BatchRun.Progress();
        progress.setTotal(recs.size());
        progress.setFinished(0);
        progress.setPass(0);
        progress.setDiff(0);
        progress.setFail(0);
        batch.setProgress(progress);
        List<BatchRun.CaseResult> results = new ArrayList<>();
        for (Case c : recs) {
            BatchRun.CaseResult r = new BatchRun.CaseResult();
            r.setCaseId(c.getId());
            r.setTxnCode(c.getTxnCode());
            r.setStatus("pending");
            results.add(r);
        }
        batch.setCaseResults(results);
        batchRunMapper.updateById(batch);

        AtomicInteger i = new AtomicInteger(0);
        String runBy = metaService.currentUser().getName();
        final java.util.concurrent.ScheduledFuture<?>[] holder = new java.util.concurrent.ScheduledFuture<?>[1];
        holder[0] = asyncRunner.executor().scheduleWithFixedDelay(() -> {
            try {
                if (i.get() >= recs.size()) {
                    holder[0].cancel(false);
                    return;
                }
                int idx = i.getAndIncrement();
                Case c = recs.get(idx);
                RunContext ctx = RunContext.builder()
                        .config(configService.get())
                        .type("BATCH")
                        .batchId(batch.getId())
                        .runBy(runBy)
                        .runIndex(1)
                        .at(TimeUtil.now())
                        .version(batch.getVersion())
                        .build();
                Run run = generatorService.runCase(c, ctx);
                runMapper.insert(run);
                c.setLastRun(run);
                caseMapper.updateById(c);
                BatchRun latest = batchRunMapper.selectById(batch.getId());
                if (latest == null) return;
                latest.getProgress().setFinished(i.get());
                BatchRun.CaseResult res = latest.getCaseResults().get(idx);
                res.setStatus(run.getVerdict());
                if ("PASS".equals(run.getVerdict())) latest.getProgress().setPass(latest.getProgress().getPass() + 1);
                else if ("FAIL".equals(run.getVerdict())) latest.getProgress().setFail(latest.getProgress().getFail() + 1);
                else latest.getProgress().setDiff(latest.getProgress().getDiff() + 1);
                if (i.get() >= recs.size()) {
                    latest.setStatus("done");
                    latest.setFinishedAt(TimeUtil.now());
                }
                batchRunMapper.updateById(latest);
            } catch (Exception e) {
                // 單條失敗不中斷批次（與 JS 異常語義一致：進度停留在當前值）
            }
        }, INTERVAL_MS, INTERVAL_MS, TimeUnit.MILLISECONDS);
    }
}
