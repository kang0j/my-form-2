-- 규칙을 「답을 보는 문항」이 소유하게 하고, 대상을 여럿 둘 수 있게 한다.
--
-- 0004 의 모양은 조건이 남의 문항을 가리킬 수 있었다. 그래서 규칙이 적힌
-- 자리(소유 문항)와 규칙이 읽는 자리(조건 문항)가 갈렸고, 관리자는 「이
-- 문항에서 아니오를 고르면 무슨 일이 일어나나」를 한 자리에서 볼 수 없었다.
-- 이제 조건은 언제나 소유 문항의 답을 본다 — rule_conditions 에서
-- question_id 가 사라지는 것이 그 사실이다.
--
-- 대상은 rule_targets 로 나간다. 「아니오면 2-1 과 2-2 를 함께 보임」이
-- 규칙 하나로 적힌다. UNIQUE 두 개가 "대상당 지목 한 번"을 그대로 지키므로
-- 규칙 충돌은 여전히 성립 불가능하다(스펙 §3.2).
--
-- 표를 다시 만드는 동안 외래키 CASCADE 가 남은 행을 쓸어 가지 않도록,
-- 옮길 데이터를 먼저 외래키 없는 백업 표에 담고 옛 표를 지운 뒤 새 표에
-- 붓는다. PRAGMA 를 끄고 켜는 방식에 기대지 않으려는 것이다.

CREATE TABLE _rule_backup (
  id                 TEXT PRIMARY KEY,
  question_id        TEXT NOT NULL,
  target_question_id TEXT,
  target_section_id  TEXT,
  match_mode         TEXT NOT NULL,
  action             TEXT NOT NULL,
  -- 소유자를 조건 문항으로 옮긴 규칙에만 1 이 선다. 옮긴 자리가 이미
  -- 차 있을 때 누구를 버릴지 정하는 데만 쓴다.
  moved              INTEGER NOT NULL DEFAULT 0
);

INSERT INTO _rule_backup (id, question_id, target_question_id, target_section_id, match_mode, action)
SELECT id, question_id, target_question_id, target_section_id, match_mode, action
FROM question_rules;

CREATE TABLE _condition_backup (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  position    INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  operator    TEXT NOT NULL,
  option_id   TEXT
);

INSERT INTO _condition_backup (id, rule_id, position, question_id, operator, option_id)
SELECT id, rule_id, position, question_id, operator, option_id
FROM rule_conditions;

-- 1) 조건이 두 문항 이상에 걸쳐 있던 규칙은 옮겨 놓을 자리가 없다. 버린다.
--    반쪽만 옮긴 규칙은 관리자가 뜻하지 않은 조건이 된다.
DELETE FROM _rule_backup WHERE id IN (
  SELECT rule_id FROM _condition_backup GROUP BY rule_id HAVING COUNT(DISTINCT question_id) > 1
);

-- 2) 조건이 남의 문항을 보던 규칙은 그 문항으로 옮긴다.
UPDATE _rule_backup
SET moved = 1,
    question_id = (
      SELECT c.question_id FROM _condition_backup c WHERE c.rule_id = _rule_backup.id LIMIT 1
    )
WHERE EXISTS (
  SELECT 1 FROM _condition_backup c
  WHERE c.rule_id = _rule_backup.id AND c.question_id <> _rule_backup.question_id
);

-- 3) 소스당 규칙 하나. 옮겨 간 자리에 원래 규칙이 있으면 옮긴 쪽이 물러난다.
DELETE FROM _rule_backup
WHERE moved = 1 AND question_id IN (SELECT question_id FROM _rule_backup WHERE moved = 0);

DELETE FROM _rule_backup
WHERE rowid NOT IN (SELECT MIN(rowid) FROM _rule_backup GROUP BY question_id);

-- 4) 옮긴 소유자가 대상과 같거나 뒤면 그 규칙은 이제 성립하지 않는다
--    (조건이 나온 뒤에 오는 것만 조종할 수 있다). 버린다.
DELETE FROM _rule_backup WHERE id IN (
  SELECT r.id
  FROM _rule_backup r
  JOIN questions oq ON oq.id = r.question_id
  JOIN sections  os ON os.id = oq.section_id
  LEFT JOIN questions tq  ON tq.id = r.target_question_id
  LEFT JOIN sections  tqs ON tqs.id = tq.section_id
  LEFT JOIN sections  ts  ON ts.id = r.target_section_id
  WHERE (
          tq.id IS NOT NULL
          AND (tqs.position < os.position
               OR (tqs.position = os.position AND tq.position <= oq.position))
        )
     OR (ts.id IS NOT NULL AND ts.position <= os.position)
);

-- 5) 주인이 사라진 조건 줄을 정리한다.
DELETE FROM _condition_backup WHERE rule_id NOT IN (SELECT id FROM _rule_backup);

DROP TABLE rule_conditions;
DROP TABLE question_rules;

CREATE TABLE question_rules (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  match_mode  TEXT NOT NULL CHECK (match_mode IN ('all','any')),
  action      TEXT NOT NULL CHECK (action IN ('show','hide'))
);

-- SQLite 에서 UNIQUE 컬럼의 NULL 은 서로 부딪히지 않는다 — 섹션 대상이
-- 여럿이어도 target_question_id 가 전부 NULL 인 것은 문제가 되지 않는다.
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

INSERT INTO question_rules (id, question_id, match_mode, action)
SELECT id, question_id, match_mode, action FROM _rule_backup;

-- 옛 규칙은 대상이 하나였으므로 규칙 id 를 대상 행 id 로 그대로 쓴다.
INSERT INTO rule_targets (id, rule_id, position, target_question_id, target_section_id)
SELECT id, id, 0, target_question_id, target_section_id FROM _rule_backup;

INSERT INTO rule_conditions (id, rule_id, position, operator, option_id)
SELECT id, rule_id, position, operator, option_id FROM _condition_backup;

DROP TABLE _condition_backup;
DROP TABLE _rule_backup;
