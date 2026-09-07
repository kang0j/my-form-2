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

/** 응답 행 INSERT 는 최초 제출과 수정이 함께 쓴다 — 같은 모양으로 들어가야 한다. */
function answerStatements(
  db: D1Database,
  survey: SurveyDef,
  input: SubmissionInput,
  submissionId: string,
): D1PreparedStatement[] {
  return buildAnswers(survey, input).map((answer) =>
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
  )
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
    ...answerStatements(db, survey, input, submissionId),
  ]

  await db.batch(statements)

  return { submissionId, duplicateIdentity }
}

export type ReplaceResult =
  | { ok: true; submissionId: string }
  | { ok: false; reason: 'submission' | 'identity' }

/**
 * 이미 낸 응답 하나를 새 답으로 갈아 끼운다.
 *
 * 새 행을 만들지 않는다 — 응답 ID 는 그대로 남고 그 아래 답만 바뀐다. 그래서
 * 사람이 들고 있는 영수증(§findSubmissionIds)이 수정 뒤에도 같은 번호를
 * 가리킨다.
 *
 * 두 개의 문(門)을 각각 따로 연다는 것이 이 함수의 제약이다.
 *
 * 1. 응답 쪽은 브라우저 키로 연다. 남의 응답 ID 를 손에 넣더라도 그 기기의
 *    키가 없으면 그 응답을 건드릴 수 없다.
 * 2. 명부 쪽은 이름·학번으로 연다 — "이 응답을 낸 사람"을 찾는 것이 아니라
 *    "지금 적어 낸 이름·학번의 명부 줄"을 찾는다. 그 둘을 대조하지 않는
 *    것이 핵심이다. 대조하는 순간 이 경로가 "응답 X 는 누구 것인가"를
 *    맞혀보는 도구가 되어 명부-응답 분리가 무너진다. 여기서 새로 드러나는
 *    사실은 "그 이름·학번이 이 설문 명부에 있는가" 하나뿐이고, 그것은
 *    최초 제출의 duplicateIdentity 가 이미 답해 주는 사실이다.
 *
 * 명부 줄이 없으면 거절한다. 없는 자리에 새로 끼워 넣으면 명부 수가 응답
 * 수보다 하나 많아진다 — 이 시스템에서 그 둘이 어긋나지 않는다는 것은
 * recordSubmission 의 원자적 배치가 지키는 성질이다.
 *
 * 제출 시각·IP·UA 는 다시 적는다. 수정도 제출이고, 명부가 말하는 "언제 냈는가"는
 * 마지막으로 낸 때여야 한다.
 */
export async function replaceSubmission(
  db: D1Database,
  secret: string,
  survey: SurveyDef,
  input: SubmissionInput,
  meta: SubmissionMeta,
  submissionId: string,
): Promise<ReplaceResult> {
  const identity = normalizeIdentity(input.name, input.studentId)

  const [browserKeyHash, ipHash, uaHash] = await Promise.all([
    hashBrowserKey(secret, input.browserKey, survey.id),
    hashIp(secret, meta.ip),
    hashUa(secret, meta.userAgent),
  ])

  const owned = await db
    .prepare(
      `SELECT id FROM submissions
       WHERE id = ? AND survey_id = ? AND browser_key_hash = ?`,
    )
    .bind(submissionId, survey.id, browserKeyHash)
    .first<{ id: string }>()

  if (!owned) return { ok: false, reason: 'submission' }

  // 같은 이름·학번으로 두 줄이 있을 수 있다(같은 신원의 중복 제출은 막지
  // 않고 탐지만 한다). 그중 하나를 고르는 기준은 ID 순이다 — rowid·삽입
  // 순서로 고르면 "먼저 낸 줄"이 어느 것인지가 드러난다.
  const participant = await db
    .prepare(
      `SELECT id FROM participants
       WHERE survey_id = ? AND name = ? AND student_id = ?
       ORDER BY id LIMIT 1`,
    )
    .bind(survey.id, identity.name, identity.studentId)
    .first<{ id: string }>()

  if (!participant) return { ok: false, reason: 'identity' }

  await db.batch([
    db
      .prepare(
        `UPDATE participants
         SET submitted_at = ?, ip_hash = ?, ua_hash = ?
         WHERE id = ?`,
      )
      .bind(meta.nowMs, ipHash, uaHash, participant.id),
    db.prepare('DELETE FROM answers WHERE submission_id = ?').bind(submissionId),
    ...answerStatements(db, survey, input, submissionId),
  ])

  return { ok: true, submissionId }
}
