-- 섹션. 투표 화면 한 장에 어떤 문항들이 함께 놓이는지만 정한다.
--
-- 제목도 설명도 없는 이유는 화면에 섹션 이름을 띄우지 않기로 했기 때문이다
-- (§SectionDef). 컬럼은 순서 하나뿐이다.
--
-- 응답 섬과는 아무 관계가 없다: 섹션은 questions 쪽에만 붙고 answers 는
-- 여전히 question_id 만 본다. 익명성 계약(명부-응답 무연결)은 그대로다.
CREATE TABLE sections (
  id        TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL
);
CREATE INDEX idx_sections_survey ON sections(survey_id, position);

-- NOT NULL 을 DB 층에 걸지 않는다.
--
-- SQLite 는 기본값 없는 NOT NULL 컬럼을 기존 표에 그냥 붙이지 못하므로,
-- 걸려면 questions 를 통째로 다시 만들어야 한다. 그런데 answers 가
-- questions(id) 를 ON DELETE CASCADE 로 참조한다 — 재작성 도중 외래 키가
-- 켜져 있으면 옛 표를 DROP 하는 순간 이미 제출된 응답이 함께 지워진다.
-- 표 하나를 바꾸자고 응답을 위험에 두지 않는다.
--
-- 대신 바로 아래에서 모든 기존 행을 채우고, 이후 쓰기는 전부
-- questionStatements() 한 곳을 지나며 항상 값을 넣는다. 읽을 때
-- (getSurvey) 짝 없는 문항은 애초에 목록에 오르지 못한다.
ALTER TABLE questions ADD COLUMN section_id TEXT REFERENCES sections(id) ON DELETE CASCADE;

-- 기존 설문은 전부 "화면 한 장짜리 설문"이었다. 설문마다 섹션 하나를
-- 만들고 그 설문의 모든 문항을 넣는다 — 투표자가 보던 흐름은 그대로다.
-- id 를 설문 id 에서 파생시키는 것은 바로 다음 UPDATE 가 조인 없이
-- 같은 값을 다시 만들어 쓰기 위해서다. 이후 새로 만드는 섹션은 다른
-- id 체계(newId)를 쓰므로 부딪히지 않는다.
INSERT INTO sections (id, survey_id, position)
SELECT 'sec-' || id, id, 0 FROM surveys;

-- questions.position 은 이제 "섹션 안에서의 순서"를 뜻한다. 기존 행은
-- 설문에 섹션이 하나뿐이라 설문 안 순서가 곧 섹션 안 순서다 — 그대로 둔다.
UPDATE questions SET section_id = 'sec-' || survey_id;

CREATE INDEX idx_questions_section ON questions(section_id, position);
