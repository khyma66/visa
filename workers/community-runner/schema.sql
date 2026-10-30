CREATE TABLE IF NOT EXISTS runner_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0,
  reason TEXT
);
INSERT OR IGNORE INTO runner_control(id) VALUES(1);
CREATE TABLE IF NOT EXISTS runner_jobs (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL,
  sequence INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('question','answer')),
  actor INTEGER NOT NULL CHECK(actor BETWEEN 0 AND 9),
  question_id TEXT,
  dependency TEXT REFERENCES runner_jobs(id),
  variant TEXT NOT NULL CHECK(variant IN ('A','B')),
  seed TEXT NOT NULL,
  title TEXT,
  body TEXT,
  remote_id TEXT UNIQUE,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','running','done','failed')),
  slot TEXT UNIQUE,
  day TEXT,
  month TEXT,
  started_at INTEGER,
  duration_ms INTEGER,
  failure TEXT
);
CREATE INDEX IF NOT EXISTS runner_queue ON runner_jobs(status,sequence);
CREATE INDEX IF NOT EXISTS runner_day ON runner_jobs(day);
CREATE INDEX IF NOT EXISTS runner_month ON runner_jobs(month);
