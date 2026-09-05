-- 예약 마감. 관리자가 "이 시각이 지나면 더 받지 않는다"를 미리 적어 둔다.
--
-- 크론을 두지 않는다. 이 값은 읽을 때 판정하고, 지난 것을 발견한 요청이
-- 그 자리에서 status 를 'closed' 로 눕힌다(§settleDueSurveys). 크론을 쓰면
-- 배포에 스케줄이 하나 더 붙고 마감이 크론 주기만큼 늦는데, 이 앱에서
-- 설문을 여는 것도 읽는 것도 사람이라 "아무도 안 보는 동안 마감되어야
-- 한다"는 요구 자체가 없다 — 다음에 누가 열어 보는 순간이 곧 마감 시점이고,
-- 그 사이에 들어온 제출은 애초에 없다.
--
-- NULL 은 "예약 없음"이다. 기존 설문은 전부 그 상태로 남는다.
-- 단위는 이 스키마의 다른 시각 컬럼들과 같은 epoch 밀리초다.
ALTER TABLE surveys ADD COLUMN close_at INTEGER;

-- 마감할 것이 있는지 묻는 질의는 항상 (status, close_at) 으로 들어온다.
CREATE INDEX idx_surveys_close_at ON surveys(status, close_at);
