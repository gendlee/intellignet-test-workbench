package com.boc.apitest.controller;

import com.boc.apitest.common.ApiResponse;
import com.boc.apitest.common.BizException;
import com.boc.apitest.common.TimeUtil;
import com.boc.apitest.entity.BatchRun;
import com.boc.apitest.entity.Case;
import com.boc.apitest.mapper.Mappers.BatchRunMapper;
import com.boc.apitest.mapper.Mappers.CaseMapper;
import com.boc.apitest.service.BatchRunner;
import com.boc.apitest.service.CaseService;
import com.boc.apitest.service.MetaService;
import com.boc.apitest.service.SeqService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;

/** 批量回歸（POST /api/batch-runs 異步執行；GET /api/batch-runs/{id}） */
@RestController
@RequiredArgsConstructor
public class BatchController {

    private final CaseMapper caseMapper;
    private final BatchRunMapper batchRunMapper;
    private final BatchRunner batchRunner;
    private final CaseService caseService;
    private final MetaService metaService;
    private final SeqService seqService;

    @PostMapping("/api/batch-runs")
    public ApiResponse<BatchRun> create(@RequestBody(required = false) JsonNode body) {
        body = body == null ? JsonNodeFactory.instance.objectNode() : body;
        List<String> caseIds = new ArrayList<>();
        if (body.has("caseIds") && body.get("caseIds").isArray()) {
            for (JsonNode n : body.get("caseIds")) caseIds.add(n.asText());
        }
        if (caseIds.isEmpty()) throw new BizException(4000, "請選擇至少一個案例");
        List<Case> recs = new ArrayList<>();
        for (String id : caseIds) {
            Case c = caseMapper.selectById(id);
            if (c != null) recs.add(c);
        }
        if (recs.isEmpty()) throw new BizException(4000, "所選案例不存在");
        String version = null;
        if (body.hasNonNull("version")) {
            version = caseService.resolveVersion(body.get("version"));
            if (version == null) throw new BizException(4000, "版本號 " + body.get("version").asText() + " 不存在，請先到案例中心維護");
        }
        BatchRun batch = new BatchRun();
        batch.setId(seqService.nextId(SeqService.PREFIX_SR));
        batch.setName(body.hasNonNull("name") && !body.get("name").asText().isEmpty()
                ? body.get("name").asText() : "批量回歸 " + TimeUtil.now().substring(5, 16).replace('-', ' '));
        batch.setCaseIds(caseIds);
        batch.setVersion(version);
        batch.setStatus("queued");
        batch.setRunBy(metaService.currentUser().getName());
        batch.setStartedAt(TimeUtil.now());
        batchRunMapper.insert(batch);
        batchRunner.start(batch, recs);
        return ApiResponse.ok(batch);
    }

    @GetMapping("/api/batch-runs/{id}")
    public ApiResponse<BatchRun> get(@PathVariable String id) {
        BatchRun b = batchRunMapper.selectById(id);
        if (b == null) throw new BizException(4040, "批量運行不存在");
        return ApiResponse.ok(b);
    }
}
