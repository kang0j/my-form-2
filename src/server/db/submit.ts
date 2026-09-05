import {
  hashBrowserKey,
  hashIp,
  hashUa,
  newId,
} from '../anonymity'
import { normalizeIdentity } from '../../shared/identity'
import { allQuestions } from '../../shared/schema'
import type { SubmissionInput, SurveyDef } from '../../shared/schema'

export type SubmissionMeta = {
  ip: string
  userAgent: string
  nowMs: number
}

export type SubmitOutcome = {
  submissionId: string
  duplicateIdentity: boolean
}

type PendingAnswer = {
  questionId: string
  optionId: string | null
  textValue: string | null
  rankPosition: number | null
}

function buildAnswers(survey: SurveyDef, input: SubmissionInput): PendingAnswer[] {
  const isOther = new Map<string, boolean>()
  for (const question of allQuestions(survey)) {
    for (const option of question.options) isOther.set(option.id, option.isOther)
  }

  const answers: PendingAnswer[] = []

  for (const answer of input.answers) {
    switch (answer.type) {
      case 'single':
        answers.push({
          questionId: answer.questionId,
          optionId: answer.optionId,
          textValue: isOther.get(answer.optionId) ? (answer.otherText ?? null) : null,
          rankPosition: null,
        })
        break
      case 'multi':
        for (const optionId of answer.optionIds) {
          answers.push({
            questionId: answer.questionId,
            optionId,
            textValue: isOther.get(optionId) ? (answer.otherText ?? null) : null,
            rankPosition: null,
          })
        }
        break
      case 'text':
        if (answer.text.trim() !== '') {
          answers.push({
            questionId: answer.questionId,
            optionId: null,
            textValue: answer.text,
            rankPosition: null,
          })
        }
        break
      case 'ranking':
        answer.order.forEach((optionId, index) => {
          answers.push({
            questionId: answer.questionId,
            optionId,
            textValue: null,
            rankPosition: index + 1,
          })
        })
        break
    }
  }

  return answers
}

/**
 * 명부 한 행과 응답 행들을 D1 배치 하나로 기록한다.
 *
 * 둘 다 쓰이거나 둘 다 안 쓰이거나이므로 명부 수와 응답 수가 어긋날 수 없다.
 * 두 묶음 사이에 공통 식별자를 넣지 않는 것이 이 함수의 핵심 제약이다.
 */
export async function recordSubmission(
  db: D1Database,
  secret: string,
  survey: SurveyDef,
  input: SubmissionInput,
  meta: SubmissionMeta,
): Promise<SubmitOutcome> {
  // 신원은 명부에 들어가기 직전 이 한 곳에서 정규화한다. 이 뒤로는 허용
  // 명단 대조(§getRoster)도 신원 중복 탐지도 전부 순수 문자열 비교로 산다 —
  // 「홍  길동」과 「홍 길동」을 다른 사람으로 세는 실수가 생길 자리가 없다.
  const identity = normalizeIdentity(input.name, input.studentId)

  const existing = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM participants
       WHERE survey_id = ? AND name = ? AND student_id = ?`,
    )
    .bind(survey.id, identity.name, identity.studentId)
    .first<{ n: number }>()

  const duplicateIdentity = (existing?.n ?? 0) > 0

  const participantId = newId()
  const submissionId = newId()

  const [browserKeyHash, ipHash, uaHash] = await Promise.all([
    hashBrowserKey(secret, input.browserKey, survey.id),
    hashIp(secret, meta.ip),
    hashUa(secret, meta.userAgent),
  ])

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO participants
           (id, survey_id, name, student_id, submitted_at, ip_hash, ua_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(participantId, survey.id, identity.name, identity.studentId, meta.nowMs, ipHash, uaHash),
    db
      .prepare(
        `INSERT INTO submissions (id, survey_id, browser_key_hash)
         VALUES (?, ?, ?)`,
      )
      .bind(submissionId, survey.id, browserKeyHash),
    ...buildAnswers(survey, input).map((answer) =>
      db
        .prepare(
          `INSERT INTO answers
             (id, submission_id, question_id, option_id, text_value, rank_position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          submissionId,
          answer.questionId,
          answer.optionId,
          answer.textValue,
          answer.rankPosition,
        ),
    ),
  ]

  await db.batch(statements)

  return { submissionId, duplicateIdentity }
}
