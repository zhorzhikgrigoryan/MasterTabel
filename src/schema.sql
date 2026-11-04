-- MasterTabel schema. Safe to run on every start.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id               SERIAL PRIMARY KEY,
  full_name        TEXT NOT NULL,
  phone            TEXT NOT NULL,
  telegram_id      BIGINT UNIQUE,
  tg_username      TEXT,
  lang             TEXT NOT NULL DEFAULT 'hy',
  status           TEXT NOT NULL DEFAULT 'invited',   -- invited | active | deactivated
  invite_token     TEXT UNIQUE,
  break_min        INTEGER NOT NULL DEFAULT 0,
  pay_cycle        TEXT NOT NULL DEFAULT 'monthly',   -- weekly | monthly
  sched_days       INTEGER[] NOT NULL DEFAULT '{}',   -- ISO weekdays 1=Mon..7=Sun
  sched_start      TEXT,                              -- 'HH:MM'
  sched_end        TEXT,                              -- 'HH:MM'
  remind_in_after  INTEGER,                           -- minutes; NULL = use global default
  remind_out_again INTEGER,                           -- minutes; NULL = use global default
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rates (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  hourly_amd     INTEGER NOT NULL,
  effective_from DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS shifts (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date      DATE NOT NULL,
  check_in       TIMESTAMPTZ NOT NULL,
  check_out      TIMESTAMPTZ,
  in_source      TEXT NOT NULL DEFAULT 'tap',          -- tap | request | admin
  out_source     TEXT,                                 -- tap | request | admin
  status         TEXT NOT NULL DEFAULT 'open',         -- open | closed | review
  needs_approval BOOLEAN NOT NULL DEFAULT false,       -- set by "I forgot" requests
  late           BOOLEAN NOT NULL DEFAULT false,
  out_of_window  BOOLEAN NOT NULL DEFAULT false,
  edited         BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shifts_emp_date ON shifts (employee_id, work_date);

CREATE TABLE IF NOT EXISTS shift_edits (
  id          SERIAL PRIMARY KEY,
  shift_id    INTEGER,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date   DATE NOT NULL,
  field       TEXT NOT NULL,     -- check_in | check_out | break | created | deleted | approved
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS day_breaks (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date   DATE NOT NULL,
  break_min   INTEGER NOT NULL,
  PRIMARY KEY (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS adjustments (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  kind         TEXT NOT NULL,      -- bonus | advance | deduction
  amount_amd   INTEGER NOT NULL,
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  amount_amd   INTEGER NOT NULL,
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked       BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS reminders_sent (
  employee_id INTEGER NOT NULL,
  work_date   DATE NOT NULL,
  kind        TEXT NOT NULL,
  PRIMARY KEY (employee_id, work_date, kind)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token       TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,       -- claim | login
  status      TEXT NOT NULL DEFAULT 'waiting',   -- waiting | confirmed | used
  telegram_id BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
