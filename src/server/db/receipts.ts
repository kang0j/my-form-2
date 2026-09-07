import { hashBrowserKey } from '../anonymity'

/**
 * 이 기기가 이 설문에 낸 응답의 ID.
 *
 * 응답 ID 는 제출 직후 기기에 적어 두지만(§client/storage), 이 기능이 생기기
 * 전에 낸 사람의 기기에는 "냈다"는 표시만 있고 ID 가 없다. 그 기기가 자기
 * 브라우저 키를 들고 와서 되묻는 자리다.
 *
 * 익명성 표면을 넓히지 않는다: `browser_key_hash` 는 이미 같은 기기의 중복
 * 제출을 세기 위해 submissions 에 있는 값이고(§recordSubmission), 여기서
 * 돌려주는 것은 그 기기가 낸 응답의 ID 뿐이다 — 명부(participants)는 이
 * 질의에 등장하지 않으므로 "누가 냈는지"는 이 경로로도 여전히 이어지지
 * 않는다. 해시는 설문 ID 를 섞어 만들므로 설문 간 연결도 생기지 않는다.
 *
 * 정렬은 ID 순이다. rowid·삽입 순서로 정렬하면 이 기기의 제출들이 시간순으로
 * 늘어서고, 그것은 명부와 대응시킬 실마리가 된다(§getAnswerRows 와 같은 규칙).
 */
export async function findSubmissionIds(
  db: D1Database,
  secret: string,
  surveyId: string,
  browserKey: string,
): Promise<string[]> {
  const browserKeyHash = await hashBrowserKey(secret, browserKey, surveyId)

  const { results } = await db
    .prepare(
      `SELECT id FROM submissions
       WHERE survey_id = ? AND browser_key_hash = ?
       ORDER BY id`,
    )
    .bind(surveyId, browserKeyHash)
    .all<{ id: string }>()

  return results.map((row) => row.id)
}
