-- 조건 규칙. 소스 문항 하나가 대상 하나(문항 또는 섹션)를 보이거나 숨긴다.
--
-- question_id 의 UNIQUE 가 "소스당 규칙 하나"를, 두 대상 컬럼의 UNIQUE 가
-- "대상당 지목 한 번"을 못 박는다. 이 둘이 규칙 충돌을 성립 불가능하게
-- 만들므로 우선순위 해소 로직이 필요 없다.
--
-- SQLite 에서 UNIQUE 컬럼의 NULL 은 서로 부딪히지 않는다 — 섹션 대상 규칙이
-- 여럿이어도 target_question_id 가 전부 NULL 인 것은 문제가 되지 않는다.
--
-- 응답 섬과는 아무 관계가 없다. 규칙은 questions/sections 쪽에만 붙고
-- answers 는 여전히 question_id 만 본다.
CREATE TABLE question_rules (
  id                 TEXT PRIMARY KEY,
  question_id        TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  target_question_id TEXT UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  target_section_id  TEXT UNIQUE REFERENCES sections(id)  ON DELETE CASCADE,
  match_mode         TEXT NOT NULL CHECK (match_mode IN ('all','any')),
  action             TEXT NOT NULL CHECK (action IN ('show','hide')),
  CHECK ((target_question_id IS NULL) <> (target_section_id IS NULL))
);

CREATE TABLE rule_conditions (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL REFERENCES question_rules(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  operator    TEXT NOT NULL
                CHECK (operator IN ('is','is_not','includes','not_includes','answered','not_answered')),
  option_id   TEXT REFERENCES options(id)
);
CREATE INDEX idx_rule_conditions_rule ON rule_conditions(rule_id, position);
