package com.boc.apitest.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.boc.apitest.entity.BatchRun;
import com.boc.apitest.entity.Case;
import com.boc.apitest.entity.Misc.AuditLog;
import com.boc.apitest.entity.Misc.CaseType;
import com.boc.apitest.entity.Misc.Config;
import com.boc.apitest.entity.Misc.Meta;
import com.boc.apitest.entity.Misc.Module;
import com.boc.apitest.entity.Misc.SystemRec;
import com.boc.apitest.entity.Misc.Version;
import com.boc.apitest.entity.Run;
import com.boc.apitest.entity.StressPlan;
import com.boc.apitest.entity.StressRun;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** MyBatis-Plus 資料訪問層 */
public final class Mappers {

    private Mappers() {}

    @Mapper
    public interface CaseMapper extends BaseMapper<Case> {}

    @Mapper
    public interface RunMapper extends BaseMapper<Run> {}

    @Mapper
    public interface BatchRunMapper extends BaseMapper<BatchRun> {}

    @Mapper
    public interface StressPlanMapper extends BaseMapper<StressPlan> {}

    @Mapper
    public interface StressRunMapper extends BaseMapper<StressRun> {}

    @Mapper
    public interface ModuleMapper extends BaseMapper<Module> {}

    @Mapper
    public interface CaseTypeMapper extends BaseMapper<CaseType> {}

    @Mapper
    public interface VersionMapper extends BaseMapper<Version> {}

    @Mapper
    public interface SystemRecMapper extends BaseMapper<SystemRec> {}

    @Mapper
    public interface AuditLogMapper extends BaseMapper<AuditLog> {}

    @Mapper
    public interface ConfigMapper extends BaseMapper<Config> {}

    @Mapper
    public interface MetaMapper extends BaseMapper<Meta> {}

    /** 全局自增序（對齊 mock 的單一 nextId 計數器，id 形如 C0001 / R0001…） */
    @Mapper
    public interface SeqMapper {
        @Select("SELECT next_val FROM app_seq WHERE name = #{name}")
        Long selectNextVal(@Param("name") String name);

        @Update("UPDATE app_seq SET next_val = #{val} WHERE name = #{name}")
        int updateNextVal(@Param("name") String name, @Param("val") long val);

        @Insert("INSERT INTO app_seq(name, next_val) VALUES(#{name}, #{val})")
        int insertRow(@Param("name") String name, @Param("val") long val);
    }
}
