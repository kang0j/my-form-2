CREATE TABLE surveys (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','open','closed')),
  results_visibility TEXT NOT NULL DEFAULT 'admin'
                       CHECK (results_visibility IN ('admin','after_close','realtime')),
  created_at         INTEGER NOT NULL,
  opened_at          INTEGER,
  closed_at          INTEGER
);

CREATE TABLE questions (
  id          TEXT PRIMARY KEY,
  survey_id   TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('single','multi','text','ranking')),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  required    INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  min_select  INTEGER,
  max_select  INTEGER,
  allow_other INTEGER NOT NULL DEFAULT 0 CHECK (allow_other IN (0,1))
);
CREATE INDEX idx_questions_survey ON questions(survey_id, position);

CREATE TABLE options (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  label       TEXT NOT NULL,
  is_other    INTEGER NOT NULL DEFAULT 0 CHECK (is_other IN (0,1))
);
CREATE INDEX idx_options_question ON options(question_id, position);

-- 명부 섬
CREATE TABLE participants (
  id           TEXT PRIMARY KEY,
  survey_id    TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  ip_hash      TEXT NOT NULL,
  ua_hash      TEXT NOT NULL
);
CREATE INDEX idx_participants_survey ON participants(survey_id, student_id, name);

-- 응답 섬. participants 와 어떤 컬럼도 공유하지 않는다.
-- 시각 컬럼도 두지 않는다: 하루 단위로 묶어도 하루에 한 명만 제출한 날은
-- 그 자체로 명부-응답 연결 키가 되기 때문이다.
CREATE TABLE submissions (
  id               TEXT PRIMARY KEY,
  survey_id        TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  browser_key_hash TEXT NOT NULL
);
CREATE INDEX idx_submissions_survey ON submissions(survey_id, id);

CREATE TABLE answers (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id   TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id     TEXT REFERENCES options(id),
  text_value    TEXT,
  rank_position INTEGER
);
CREATE INDEX idx_answers_submission ON answers(submission_id);
CREATE INDEX idx_answers_question ON answers(question_id);
