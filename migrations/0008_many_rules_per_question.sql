-- 한 문항이 규칙을 여러 개 갖는다.
--
-- 0004 부터 `question_rules.question_id` 에 UNIQUE 가 있었다. 「예면 1번을
-- 보임」과 「아니오면 2번을 보임」은 조건이 서로 다른 두 규칙인데, 그 제약
-- 아래에서는 한 문항에 하나만 적을 수 있었다 — AND/OR 로는 적을 수 없는
-- 모양이다(예이면서 동시에 아니오인 답은 없다).
--
-- 충돌을 막는 것은 이제 rule_targets 의 UNIQUE, 곧 「대상당 지목 한 번」
-- 하나다. 한 대상을 두 규칙이 조종하지 못하므로 규칙이 몇 개든 서로 다른
-- 말을 할 자리가 없다.
--
-- position 은 편집기가 보여주는 순서다. 없으면 「조건 1」과 「조건 2」의
-- 자리가 읽을 때마다 바뀔 수 있다.
--
-- 규칙 행은 옮기지 않고 버린다. 규칙은 draft 상태의 설문에서만 편집되고,
-- 이 표들을 다시 만드는 값은 그 초안을 한 번 다시 저장하는 것뿐이다.
-- 세 표는 서로만 참조하므로 자식부터 지우면 CASCADE 가 다른 것을 건드리지
-- 않는다.

DROP TABLE rule_targets;
DROP TABLE rule_conditions;
DROP TABLE question_rules;

CREATE TABLE question_rules (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  match_mode  TEXT NOT NULL CHECK (match_mode IN ('all','any')),
  action      TEXT NOT NULL CHECK (action IN ('show','hide'))
);
CREATE INDEX idx_question_rules_question ON question_rules(question_id, position);

CREATE TABLE rule_targets (
  id                 TEXT PRIMARY KEY,
  rule_id            TEXT NOT NULL REFERENCES question_rules(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL,
  target_question_id TEXT UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  target_section_id  TEXT UNIQUE REFERENCES sections(id)  ON DELETE CASCADE,
  CHECK ((target_question_id IS NULL) <> (target_section_id IS NULL))
);
CREATE INDEX idx_rule_targets_rule ON rule_targets(rule_id, position);

CREATE TABLE rule_conditions (
  id        TEXT PRIMARY KEY,
  rule_id   TEXT NOT NULL REFERENCES question_rules(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  operator  TEXT NOT NULL
              CHECK (operator IN ('is','is_not','includes','not_includes','answered','not_answered')),
  option_id TEXT REFERENCES options(id)
);
CREATE INDEX idx_rule_conditions_rule ON rule_conditions(rule_id, position);
