import type { AnswerRow } from '../aggregate'

/**
 * 응답 행을 읽는다. 정렬은 반드시 ID 순이다.
 * rowid 나 삽입 순서로 정렬하면 명부와 시간순으로 대응시킬 수 있게 된다.
 */
export async function getAnswerRows(
  db: D1Database,
  surveyId: string,
): Promise<AnswerRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.submission_id AS submissionId,
              a.question_id   AS questionId,
              a.option_id     AS optionId,
              a.text_value    AS textValue,
              a.rank_position AS rankPosition
       FROM answers a
       JOIN submissions s ON s.id = a.submission_id
       WHERE s.survey_id = ?
       ORDER BY a.submission_id, a.id`,
    )
    .bind(surveyId)
    .all<AnswerRow>()

  return results
}

export async function countSubmissions(db: D1Database, surveyId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM submissions WHERE survey_id = ?')
    .bind(surveyId)
    .first<{ n: number }>()
  return row?.n ?? 0
}
