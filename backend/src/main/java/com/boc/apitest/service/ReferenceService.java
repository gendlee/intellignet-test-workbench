package com.boc.apitest.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boc.apitest.common.BizException;
import com.boc.apitest.common.TimeUtil;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Misc.CaseType;
import com.boc.apitest.entity.Misc.Module;
import com.boc.apitest.entity.Misc.Version;
import com.boc.apitest.entity.Run;
import com.boc.apitest.mapper.Mappers.CaseMapper;
import com.boc.apitest.mapper.Mappers.CaseTypeMapper;
import com.boc.apitest.mapper.Mappers.ModuleMapper;
import com.boc.apitest.mapper.Mappers.RunMapper;
import com.boc.apitest.mapper.Mappers.VersionMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 引用數據維護（mock/routes.js 移植）：
 * - 業務模組：CRUD + caseCount；刪除前檢查「該模組下仍有案例」
 * - 案例類型：CRUD + caseCount；刪除前檢查「該類型下仍有案例」
 * - 版本號：GET 統計 runCount / executedCaseCount / linkedCaseCount / caseCount（執行 ∪ 關聯）；
 *   POST 驗證 YYYY-MM + A/Z，code = YYYYMM + mode
 */
@Service
@RequiredArgsConstructor
public class ReferenceService {

    private static final Pattern MONTH_RE = Pattern.compile("^\\d{4}-\\d{2}$");

    private final ModuleMapper moduleMapper;
    private final CaseTypeMapper caseTypeMapper;
    private final VersionMapper versionMapper;
    private final CaseMapper caseMapper;
    private final RunMapper runMapper;
    private final SeqService seqService;

    /* ---------- 業務模組 ---------- */

    public List<Module> listModules() {
        List<Module> list = moduleMapper.selectList(new LambdaQueryWrapper<Module>().orderByAsc(Module::getId));
        for (Module m : list) {
            long n = caseMapper.selectCount(new LambdaQueryWrapper<Case>().eq(Case::getModule, m.getName()));
            m.setCaseCount((int) n);
        }
        return list;
    }

    public Module createModule(String name, String code, String description) {
        if (name == null || name.isEmpty() || code == null || code.isEmpty()) throw new BizException(4000, "模組名稱與代碼必填");
        long exists = moduleMapper.selectCount(new LambdaQueryWrapper<Module>().eq(Module::getCode, code));
        if (exists > 0) throw new BizException(4000, "模組代碼 " + code + " 已存在");
        Module m = new Module();
        m.setId(seqService.nextId(SeqService.PREFIX_MODULE));
        m.setName(name);
        m.setCode(code);
        m.setDescription(description == null ? "" : description);
        m.setCreatedAt(TimeUtil.now());
        moduleMapper.insert(m);
        return m;
    }

    public Module updateModule(String id, String name, String code, String description, boolean hasDescription) {
        Module m = moduleMapper.selectById(id);
        if (m == null) throw new BizException(4040, "模組不存在");
        if (name != null && !name.isEmpty()) m.setName(name);
        if (code != null && !code.isEmpty()) m.setCode(code);
        if (hasDescription) m.setDescription(description);
        moduleMapper.updateById(m);
        return m;
    }

    public Module deleteModule(String id) {
        Module m = moduleMapper.selectById(id);
        if (m == null) throw new BizException(4040, "模組不存在");
        long n = caseMapper.selectCount(new LambdaQueryWrapper<Case>().eq(Case::getModule, m.getName()));
        if (n > 0) throw new BizException(4000, "該模組下仍有案例，無法刪除（可改為停用或先調整案例）");
        moduleMapper.deleteById(id);
        return m;
    }

    /* ---------- 案例類型 ---------- */

    public List<CaseType> listCaseTypes() {
        List<CaseType> list = caseTypeMapper.selectList(new LambdaQueryWrapper<CaseType>().orderByAsc(CaseType::getId));
        for (CaseType t : list) {
            long n = caseMapper.selectCount(new LambdaQueryWrapper<Case>().eq(Case::getType, t.getName()));
            t.setCaseCount((int) n);
        }
        return list;
    }

    public CaseType createCaseType(String name, String description) {
        if (name == null || name.trim().isEmpty()) throw new BizException(4000, "案例類型名稱必填");
        long exists = caseTypeMapper.selectCount(new LambdaQueryWrapper<CaseType>().eq(CaseType::getName, name));
        if (exists > 0) throw new BizException(4000, "案例類型「" + name + "」已存在");
        CaseType t = new CaseType();
        t.setId(seqService.nextId(SeqService.PREFIX_CASE_TYPE));
        t.setName(name);
        t.setDescription(description == null ? "" : description);
        t.setCreatedAt(TimeUtil.now());
        caseTypeMapper.insert(t);
        return t;
    }

    public CaseType updateCaseType(String id, String name, String description, boolean hasDescription) {
        CaseType t = caseTypeMapper.selectById(id);
        if (t == null) throw new BizException(4040, "案例類型不存在");
        if (name != null && !name.isEmpty()) {
            long dup = caseTypeMapper.selectCount(new LambdaQueryWrapper<CaseType>().eq(CaseType::getName, name).ne(CaseType::getId, id));
            if (dup > 0) throw new BizException(4000, "案例類型「" + name + "」已存在");
            t.setName(name);
        }
        if (hasDescription) t.setDescription(description);
        caseTypeMapper.updateById(t);
        return t;
    }

    public CaseType deleteCaseType(String id) {
        CaseType t = caseTypeMapper.selectById(id);
        if (t == null) throw new BizException(4040, "案例類型不存在");
        long n = caseMapper.selectCount(new LambdaQueryWrapper<Case>().eq(Case::getType, t.getName()));
        if (n > 0) throw new BizException(4000, "該類型下仍有案例，無法刪除（可先調整案例類型）");
        caseTypeMapper.deleteById(id);
        return t;
    }

    /* ---------- 版本號 ---------- */

    public List<Version> listVersions() {
        List<Version> list = versionMapper.selectList(null);
        list.sort((a, b) -> b.getCode().compareTo(a.getCode())); // code 降序（YYYYMM+A/Z 即時間序）
        for (Version v : list) {
            List<Run> runs = runMapper.selectList(new LambdaQueryWrapper<Run>().eq(Run::getVersion, v.getCode()));
            Set<String> executed = new HashSet<>();
            for (Run r : runs) executed.add(r.getCaseId());
            long linked = caseMapper.selectCount(new LambdaQueryWrapper<Case>().like(Case::getVersions, "\"" + v.getCode() + "\""));
            v.setRunCount(runs.size());
            v.setExecutedCaseCount(executed.size());
            v.setLinkedCaseCount(linked);
            Set<String> union = new HashSet<>(executed);
            union.addAll(linkedCaseIds(v.getCode()));
            v.setCaseCount(union.size());
        }
        return list;
    }

    private List<String> linkedCaseIds(String code) {
        List<Case> cases = caseMapper.selectList(new LambdaQueryWrapper<Case>().like(Case::getVersions, "\"" + code + "\""));
        return cases.stream().map(Case::getId).toList();
    }

    public Version createVersion(String month, String mode) {
        if (month == null || !MONTH_RE.matcher(month).matches()) throw new BizException(4000, "月份格式須為 YYYY-MM");
        if (!"A".equals(mode) && !"Z".equals(mode)) throw new BizException(4000, "模式須為 A（集中版本）或 Z（非集中版本）");
        String code = month.replace("-", "") + mode;
        long exists = versionMapper.selectCount(new LambdaQueryWrapper<Version>().eq(Version::getCode, code));
        if (exists > 0) throw new BizException(4000, "版本號 " + code + " 已存在");
        Version v = new Version();
        v.setId(seqService.nextId(SeqService.PREFIX_VERSION));
        v.setCode(code);
        v.setMonth(month.replace("-", ""));
        v.setMode(mode);
        v.setModeLabel("A".equals(mode) ? "集中版本" : "非集中版本");
        v.setCreatedAt(TimeUtil.now());
        versionMapper.insert(v);
        return v;
    }

    public Version deleteVersion(String id) {
        Version v = versionMapper.selectById(id);
        if (v == null) throw new BizException(4040, "版本不存在");
        versionMapper.deleteById(id);
        return v;
    }
}
