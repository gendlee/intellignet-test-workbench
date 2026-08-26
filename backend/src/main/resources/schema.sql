-- 中銀香港智能化 API 測試工作台 — 資料庫結構
-- 兼容 MySQL 8 / TDSQL 與 H2（MySQL 模式）。JSON 欄位一律 LONGTEXT（兩者通用）。
-- 時間一律存 ISO-8601 UTC 字串（與 mock 保持一致，避免時區轉換口徑差異）。
-- 冪等：CREATE TABLE IF NOT EXISTS，隨 spring.sql.init.mode=always 每次啟動執行。

CREATE TABLE IF NOT EXISTS app_seq (
  name     VARCHAR(32)  NOT NULL PRIMARY KEY,
  next_val BIGINT       NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  id      VARCHAR(16) NOT NULL PRIMARY KEY,
  payload LONGTEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS systems (
  id        VARCHAR(16)  NOT NULL PRIMARY KEY,
  name      VARCHAR(64)  NOT NULL,
  active    TINYINT      NOT NULL DEFAULT 0,
  read_only TINYINT      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS config (
  id              VARCHAR(16) NOT NULL PRIMARY KEY,
  system_id       VARCHAR(16) NOT NULL DEFAULT '',
  read_only       TINYINT     NOT NULL DEFAULT 0,
  url_template    LONGTEXT,
  environments    LONGTEXT,
  default_headers LONGTEXT,
  diff_rules      LONGTEXT,
  ai              LONGTEXT
);

CREATE TABLE IF NOT EXISTS modules (
  id          VARCHAR(16) NOT NULL PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  code        VARCHAR(16) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  created_at  VARCHAR(24) NOT NULL
);

CREATE TABLE IF NOT EXISTS case_types (
  id          VARCHAR(16) NOT NULL PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  created_at  VARCHAR(24) NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id         VARCHAR(16) NOT NULL PRIMARY KEY,
  code       VARCHAR(16) NOT NULL,
  `month`    VARCHAR(8)  NOT NULL,
  mode       VARCHAR(2)  NOT NULL,
  mode_label VARCHAR(16) NOT NULL,
  created_at VARCHAR(24) NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id          VARCHAR(16)  NOT NULL PRIMARY KEY,
  txn_code    VARCHAR(64)  NOT NULL,
  name        VARCHAR(128) NOT NULL,
  system_id   VARCHAR(16)  NOT NULL DEFAULT '',
  module      VARCHAR(64)  NOT NULL DEFAULT '未分類',
  state_type  VARCHAR(16)  NOT NULL DEFAULT 'STATELESS',
  status      VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  precondition VARCHAR(512) NOT NULL DEFAULT '',
  mode        VARCHAR(16)  NOT NULL DEFAULT 'compare',
  host_format VARCHAR(8)   NOT NULL DEFAULT 'XML',
  profile     VARCHAR(32)  NOT NULL DEFAULT 'pass',
  type        VARCHAR(64)  NOT NULL DEFAULT 'Regular',
  test_type   VARCHAR(8)   NOT NULL DEFAULT 'SIT',
  versions    LONGTEXT,
  host_input  LONGTEXT,
  new_input   LONGTEXT,
  ai_meta     LONGTEXT,
  review      LONGTEXT,
  created_by  VARCHAR(64)  NOT NULL DEFAULT '',
  created_at  VARCHAR(24)  NOT NULL,
  updated_at  VARCHAR(24)  NOT NULL,
  last_run    LONGTEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id             VARCHAR(16)  NOT NULL PRIMARY KEY,
  case_id        VARCHAR(16)  NOT NULL,
  batch_id       VARCHAR(16),
  type           VARCHAR(16)  NOT NULL DEFAULT 'SINGLE',
  version        VARCHAR(16),
  case_type      VARCHAR(64),
  test_type      VARCHAR(8),
  input_snapshot LONGTEXT,
  host_result    LONGTEXT,
  new_result     LONGTEXT,
  diff           LONGTEXT,
  verdict        VARCHAR(8)   NOT NULL,
  steps          LONGTEXT,
  state_note     VARCHAR(512),
  run_by         VARCHAR(64)  NOT NULL,
  started_at     VARCHAR(24)  NOT NULL,
  finished_at    VARCHAR(24)  NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_runs (
  id           VARCHAR(16) NOT NULL PRIMARY KEY,
  name         VARCHAR(128) NOT NULL,
  case_ids     LONGTEXT,
  version      VARCHAR(16),
  status       VARCHAR(16) NOT NULL,
  progress     LONGTEXT,
  case_results LONGTEXT,
  run_by       VARCHAR(64) NOT NULL,
  started_at   VARCHAR(24) NOT NULL,
  finished_at  VARCHAR(24)
);

CREATE TABLE IF NOT EXISTS stress_plans (
  id           VARCHAR(16)  NOT NULL PRIMARY KEY,
  name         VARCHAR(128) NOT NULL,
  method       VARCHAR(8)   NOT NULL DEFAULT 'POST',
  url          VARCHAR(255) NOT NULL,
  headers      LONGTEXT,
  body         LONGTEXT,
  concurrency  INT NOT NULL DEFAULT 10,
  duration_sec INT NOT NULL DEFAULT 60,
  ramp_up_sec  INT NOT NULL DEFAULT 10,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending',
  review       LONGTEXT,
  run_count    INT NOT NULL DEFAULT 0,
  created_by   VARCHAR(64) NOT NULL,
  created_at   VARCHAR(24) NOT NULL,
  last_run     LONGTEXT
);

CREATE TABLE IF NOT EXISTS stress_runs (
  id          VARCHAR(16) NOT NULL PRIMARY KEY,
  plan_id     VARCHAR(16) NOT NULL,
  status      VARCHAR(16) NOT NULL,
  started_at  VARCHAR(24) NOT NULL,
  finished_at VARCHAR(24) NOT NULL,
  summary     LONGTEXT,
  series      LONGTEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          VARCHAR(32) NOT NULL PRIMARY KEY,
  case_id     VARCHAR(16) NOT NULL,
  action      VARCHAR(16) NOT NULL,
  from_status VARCHAR(16) NOT NULL DEFAULT '',
  to_status   VARCHAR(16) NOT NULL DEFAULT '',
  operator    VARCHAR(64) NOT NULL,
  at          VARCHAR(24) NOT NULL,
  comment     VARCHAR(255) NOT NULL DEFAULT ''
);
