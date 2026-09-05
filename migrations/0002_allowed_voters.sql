-- 허용 명단. 이 설문에 응답할 수 있는 사람을 관리자가 미리 적어 둔다.
--
-- 명부 섬(participants)에 속한다: 이름·학번만 들고 있고, 응답 섬
-- (submissions/answers)과 어떤 컬럼도 공유하지 않는다. 새 연결 고리를
-- 만들지 않으므로 "누가 무엇을 골랐는지 이어지지 않는다"는 성질은 그대로다.
--
-- 시각 컬럼을 두지 않는 이유도 명부·응답과 같다 — 하루에 한 명만 추가된
-- 날은 그 자체로 조인 키가 된다.
--
-- 이 표가 비어 있으면 "아무도 못 들어온다"가 아니라 "제한하지 않는다"는
-- 뜻이다(§isAllowed). 그래서 이 마이그레이션은 기존 설문의 동작을 바꾸지
-- 않는다.
CREATE TABLE allowed_voters (
  id         TEXT PRIMARY KEY,
  survey_id  TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  student_id TEXT NOT NULL
);

-- 조회는 항상 (survey_id) 또는 (survey_id, name, student_id)로 들어온다.
-- UNIQUE 는 같은 사람이 명단에 두 줄로 들어가는 것을 DB 층에서 막는다 —
-- 그러면 미참가 명단에 같은 이름이 두 번 뜨는 일이 없다.
CREATE UNIQUE INDEX idx_allowed_voters_identity
  ON allowed_voters(survey_id, name, student_id);
