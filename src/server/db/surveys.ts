import { newId, newSurveyId } from '../anonymity'
import { surveyToDraft } from '../../shared/rules'
import { getAllowlist, replaceAllowlist } from './allowlist'
import type {
  ConditionOperator,
  QuestionDef,
  RuleDef,
  RuleTarget,
  SectionDef,
  ResultsVisibility,
  SurveyDef,
  SurveyDraftInput,
  SurveyStatus,
} from '../../shared/schema'

export class SurveyStateError extends Error {}

/** 설문이 아예 없는 경우. 상태가 맞지 않는 경우(SurveyStateError, 409)와 구별해 404로 매핑한다. */
export class SurveyNotFoundError extends SurveyStateError {}

export type SurveySummary = {
  id: string
  title: string
  status: SurveyStatus
  resultsVisibility: ResultsVisibility
  participantCount: number
  createdAt: number
  closeAt: number | null
}

/**
 * 예약 마감 시각이 지난 설문을 실제로 마감한다.
 *
 * 크론이 아니라 읽기가 이 일을 한다 — 설문을 읽는 모든 길목(getSurvey,
 * listSurveys)이 먼저 이 함수를 지나므로, 마감 시각이 지난 설문을 열려
 * 있는 것으로 보는 요청은 없다. 투표자가 제출하려는 순간에도 같은 판정을
 * 거친다(routes/public.ts 가 getSurvey 로 시작한다).
 *
 * 상태를 그 자리에서 DB 에 눕히는 이유는 "읽을 때만 계산"으로 두면
 * status 컬럼이 계속 'open' 이라 「다시 열기」(requireStatus 가 raw 값을
 * 본다) 같은 전이가 어긋나기 때문이다. 마감 시각은 closed_at 에 그대로
 * 옮겨 적는다 — 실제로 마감된 시각은 누가 열어 본 시각이 아니라 관리자가
 * 정한 그 시각이다.
 *
 * `id` 를 주면 그 설문만 본다. 목록 화면은 생략해서 한 번에 정리한다.
 */
export async function settleDueSurveys(
  db: D1Database,
  nowMs: number,
  id?: string,
): Promise<void> {
  const scope = id ? ' AND id = ?' : ''
  const statement = db.prepare(
    `UPDATE surveys SET status = 'closed', closed_at = close_at
     WHERE status = 'open' AND close_at IS NOT NULL AND close_at <= ?${scope}`,
  )
  await (id ? statement.bind(nowMs, id) : statement.bind(nowMs)).run()
}

type QuestionRow = {
  id: string
  section_id: string
  position: number
  type: QuestionDef['type']
  title: string
  description: string
  required: number
  min_select: number | null
  max_select: number | null
  allow_other: number
}

type OptionRow = {
  id: string
  question_id: string
  position: number
  label: string
  is_other: number
}

type RuleRow = {
  id: string
  question_id: string
  position: number
  match_mode: 'all' | 'any'
  action: 'show' | 'hide'
}

type TargetRow = {
  rule_id: string
  position: number
  target_question_id: string | null
  target_section_id: string | null
}

type ConditionRow = {
  rule_id: string
  position: number
  operator: ConditionOperator
  option_id: string | null
}

function sectionStatements(
  db: D1Database,
  surveyId: string,
  draft: SurveyDraftInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []

  // 규칙이 인덱스로 가리키는 것을 실제 ID 로 바꾸려면 먼저 전부 발급해야
  // 한다. 평면 순서(allQuestions 순서)로 모아 둔다.
  const sectionIds: string[] = []
  const questionIds: string[] = []
  const optionIdsByQuestion: string[][] = []

  draft.sections.forEach((section, sectionIndex) => {
    const sectionId = newId()
    sectionIds.push(sectionId)
    statements.push(
      db
        .prepare('INSERT INTO sections (id, survey_id, position) VALUES (?, ?, ?)')
        .bind(sectionId, surveyId, sectionIndex),
    )

    // position 은 섹션 안에서의 순서다. 설문 전체 통번호가 아니다 — 섹션을
    // 통째로 옮겨도 그 안의 문항 순서는 건드릴 일이 없어야 한다.
    section.questions.forEach((question, questionIndex) => {
      const questionId = newId()
      questionIds.push(questionId)
      statements.push(
        db
          .prepare(
            `INSERT INTO questions
               (id, survey_id, section_id, position, type, title, description, required, min_select, max_select, allow_other)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            questionId,
            surveyId,
            sectionId,
            questionIndex,
            question.type,
            question.title,
            question.description,
            question.required ? 1 : 0,
            question.minSelect,
            question.maxSelect,
            question.allowOther ? 1 : 0,
          ),
      )

      const optionIds: string[] = []
      question.options.forEach((option, optionIndex) => {
        const optionId = newId()
        optionIds.push(optionId)
        statements.push(
          db
            .prepare(
              `INSERT INTO options (id, question_id, position, label, is_other)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(optionId, questionId, optionIndex, option.label, option.isOther ? 1 : 0),
        )
      })
      optionIdsByQuestion.push(optionIds)
    })
  })

  // 두 번째 패스: 규칙. 여기서 인덱스가 ID 가 된다. 잘못된 인덱스는
  // checkRules 가 이미 걸렀으므로(routes/admin.ts) 여기서는 없는 것으로
  // 나오면 그 규칙을 조용히 건너뛴다 — 반쪽짜리 규칙을 쓰는 것보다 낫다.
  let flatIndex = 0
  for (const section of draft.sections) {
    for (const question of section.questions) {
      const ownerIndex = flatIndex
      const ownerId = questionIds[ownerIndex]
      flatIndex += 1

      for (const [rulePosition, rule] of (question.rules ?? []).entries()) {
        // 대상이 하나도 살아남지 않은 규칙은 아무 일도 하지 않는다 — 조건
        // 줄만 남은 행을 만들지 않고 통째로 건너뛴다.
        type TargetIds = { questionId: string | null; sectionId: string | null }
        const targets = rule.targets.flatMap((target): TargetIds[] => {
          if (target.kind === 'question') {
            const id = questionIds[target.questionIndex]
            return id ? [{ questionId: id, sectionId: null }] : []
          }
          const id = sectionIds[target.sectionIndex]
          return id ? [{ questionId: null, sectionId: id }] : []
        })
        if (targets.length === 0) continue

        const ruleId = newId()
        statements.push(
          db
            .prepare(
              `INSERT INTO question_rules (id, question_id, position, match_mode, action)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(ruleId, ownerId, rulePosition, rule.match, rule.action),
        )

        targets.forEach((target, position) => {
          statements.push(
            db
              .prepare(
                `INSERT INTO rule_targets
                   (id, rule_id, position, target_question_id, target_section_id)
                 VALUES (?, ?, ?, ?, ?)`,
              )
              .bind(newId(), ruleId, position, target.questionId, target.sectionId),
          )
        })

        // 조건이 보는 것은 소유 문항의 답이므로 보기도 소유 문항에서 찾는다.
        const ownerOptionIds = optionIdsByQuestion[ownerIndex] ?? []
        rule.conditions.forEach((condition, position) => {
          const optionId =
            condition.optionIndex === null ? null : (ownerOptionIds[condition.optionIndex] ?? null)

          statements.push(
            db
              .prepare(
                `INSERT INTO rule_conditions
                   (id, rule_id, position, operator, option_id)
                 VALUES (?, ?, ?, ?, ?)`,
              )
              .bind(newId(), ruleId, position, condition.operator, optionId),
          )
        })
      }
    }
  }

  return statements
}

/**
 * 설문 ID 는 6자로 짧아서(§newSurveyId) UUID 와 달리 충돌을 "일어나지
 * 않는 일"로 취급할 수 없다 — 확률이 낮을 뿐 0 은 아니다. 미리
 * SELECT 로 비었는지 보는 방식은 확인과 INSERT 사이에 다른 요청이
 * 끼어들면 그대로 뚫리므로, 실제 권위인 PRIMARY KEY 제약이 거부한
 * 것을 받아서 다시 뽑는다.
 */
const CREATE_SURVEY_ATTEMPTS = 5

function isIdCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed: surveys\.id/i.test(message)
}

export async function createSurvey(
  db: D1Database,
  draft: SurveyDraftInput,
  nowMs: number,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const surveyId = newSurveyId()

    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO surveys (id, title, description, status, results_visibility, created_at)
             VALUES (?, ?, ?, 'draft', ?, ?)`,
          )
          .bind(surveyId, draft.title, draft.description, draft.resultsVisibility, nowMs),
        ...sectionStatements(db, surveyId, draft),
      ])
    } catch (error) {
      // batch 는 원자적이라 실패한 시도는 문항·보기까지 통째로 없던 일이
      // 된다 — 다음 시도가 남은 찌꺼기를 밟을 일이 없다.
      if (isIdCollision(error) && attempt < CREATE_SURVEY_ATTEMPTS) continue
      throw error
    }

    return surveyId
  }
}

/**
 * nowMs 는 예약 마감 판정에만 쓴다. 기본값을 두는 것은 부르는 곳이
 * 열 군데가 넘는데 그 대부분이 "지금"이기 때문이고, 시험은 값을 넣어
 * 시계를 옮긴다.
 */
export async function getSurvey(
  db: D1Database,
  id: string,
  nowMs: number = Date.now(),
): Promise<SurveyDef | null> {
  await settleDueSurveys(db, nowMs, id)

  const survey = await db
    .prepare(
      `SELECT id, title, description, status, results_visibility AS resultsVisibility,
              close_at AS closeAt
       FROM surveys WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: string
      title: string
      description: string
      status: SurveyStatus
      resultsVisibility: ResultsVisibility
      closeAt: number | null
    }>()

  if (!survey) return null

  const { results: sectionRows } = await db
    .prepare('SELECT id FROM sections WHERE survey_id = ? ORDER BY position')
    .bind(id)
    .all<{ id: string }>()

  // JOIN 이라 section_id 가 비어 있는 문항은 목록에 오르지 않는다. 0003
  // 마이그레이션이 기존 행을 전부 채웠고 이후 쓰기는 sectionStatements 한
  // 곳을 지나므로 그런 행은 생기지 않지만, 혹 생기더라도 어느 화면에도
  // 놓을 수 없는 문항을 조용히 설문 끝에 붙이는 것보다 낫다.
  const { results: questionRows } = await db
    .prepare(
      `SELECT q.id, q.section_id, q.position, q.type, q.title, q.description,
              q.required, q.min_select, q.max_select, q.allow_other
       FROM questions q
       JOIN sections s ON s.id = q.section_id
       WHERE q.survey_id = ?
       ORDER BY s.position, q.position`,
    )
    .bind(id)
    .all<QuestionRow>()

  const { results: optionRows } = await db
    .prepare(
      `SELECT o.id, o.question_id, o.position, o.label, o.is_other
       FROM options o
       JOIN questions q ON q.id = o.question_id
       JOIN sections s ON s.id = q.section_id
       WHERE q.survey_id = ?
       ORDER BY s.position, q.position, o.position`,
    )
    .bind(id)
    .all<OptionRow>()

  const { results: ruleRows } = await db
    .prepare(
      `SELECT r.id, r.question_id, r.position, r.match_mode, r.action
       FROM question_rules r
       JOIN questions q ON q.id = r.question_id
       WHERE q.survey_id = ?
       ORDER BY r.question_id, r.position`,
    )
    .bind(id)
    .all<RuleRow>()

  const { results: targetRows } = await db
    .prepare(
      `SELECT t.rule_id, t.position, t.target_question_id, t.target_section_id
       FROM rule_targets t
       JOIN question_rules r ON r.id = t.rule_id
       JOIN questions q ON q.id = r.question_id
       WHERE q.survey_id = ?
       ORDER BY t.rule_id, t.position`,
    )
    .bind(id)
    .all<TargetRow>()

  const { results: conditionRows } = await db
    .prepare(
      `SELECT c.rule_id, c.position, c.operator, c.option_id
       FROM rule_conditions c
       JOIN question_rules r ON r.id = c.rule_id
       JOIN questions q ON q.id = r.question_id
       WHERE q.survey_id = ?
       ORDER BY c.rule_id, c.position`,
    )
    .bind(id)
    .all<ConditionRow>()

  function toRules(questionId: string): RuleDef[] {
    return ruleRows
      .filter((r) => r.question_id === questionId)
      .flatMap((row): RuleDef[] => {
        // CHECK 제약이 대상 두 컬럼 중 정확히 하나만 채워지는 것을
        // 보장하지만, 읽는 쪽도 한 번 더 확인한다 — 손으로 넣은 행이 있어도
        // 반쪽짜리 대상을 만들지 않는다.
        const targets = targetRows
          .filter((t) => t.rule_id === row.id)
          .flatMap((t): RuleTarget[] => {
            if (t.target_question_id) {
              return [{ kind: 'question', questionId: t.target_question_id }]
            }
            if (t.target_section_id) return [{ kind: 'section', sectionId: t.target_section_id }]
            return []
          })
        if (targets.length === 0) return []

        return [
          {
            match: row.match_mode,
            action: row.action,
            targets,
            conditions: conditionRows
              .filter((c) => c.rule_id === row.id)
              .map((c) => ({
                operator: c.operator,
                optionId: c.option_id,
              })),
          },
        ]
      })
  }

  function toQuestion(row: QuestionRow): QuestionDef {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      required: row.required === 1,
      minSelect: row.min_select,
      maxSelect: row.max_select,
      allowOther: row.allow_other === 1,
      options: optionRows
        .filter((o) => o.question_id === row.id)
        .map((o) => ({ id: o.id, label: o.label, isOther: o.is_other === 1 })),
      rules: toRules(row.id),
    }
  }

  const sections: SectionDef[] = sectionRows.map((section) => ({
    id: section.id,
    questions: questionRows.filter((q) => q.section_id === section.id).map(toQuestion),
  }))

  return { ...survey, sections }
}

export async function listSurveys(
  db: D1Database,
  nowMs: number = Date.now(),
): Promise<SurveySummary[]> {
  await settleDueSurveys(db, nowMs)

  const { results } = await db
    .prepare(
      `SELECT s.id, s.title, s.status, s.results_visibility AS resultsVisibility,
              s.created_at AS createdAt, s.close_at AS closeAt,
              (SELECT COUNT(*) FROM participants p WHERE p.survey_id = s.id) AS participantCount
       FROM surveys s
       ORDER BY s.created_at DESC`,
    )
    .all<SurveySummary>()
  return results
}

/**
 * 예약 마감 시각을 정하거나(밀리초) 지운다(null).
 *
 * 상태로 잠그지 않는다 — 열기 전에 미리 잡아 두는 것도, 열어 둔 채로
 * 시각을 옮기는 것도 정상 사용이다. 이미 지난 시각을 넣는 것도 막지
 * 않는다: 그러면 다음 읽기가 곧바로 마감하는데, 그것은 「마감하기」를
 * 누른 것과 같은 결과라 놀랄 일이 아니다.
 */
export async function setCloseAt(
  db: D1Database,
  id: string,
  closeAt: number | null,
): Promise<void> {
  const result = await db
    .prepare('UPDATE surveys SET close_at = ? WHERE id = ?')
    .bind(closeAt, id)
    .run()

  if (result.meta.changes === 0) throw new SurveyNotFoundError('설문을 찾지 못했어요.')
}

/**
 * 설문을 지운다. 문항·보기·규칙·명단·명부·응답이 외래 키의 ON DELETE
 * CASCADE 로 함께 사라진다 — 되돌릴 수 없다.
 *
 * 상태로 막지 않는다. 잘못 만든 초안을 지우는 것도, 끝난 회차를 치우는
 * 것도 관리자가 할 일이고, "마감된 것만 지울 수 있다" 같은 규칙은 실수를
 * 막아 주지 못하면서 정상 사용만 불편하게 한다. 되돌릴 수 없다는 경고는
 * 누르기 전 화면에서 한다(§SurveyDetail 두 단계 확인).
 */
export async function deleteSurvey(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare('DELETE FROM surveys WHERE id = ?').bind(id).run()
  if (result.meta.changes === 0) throw new SurveyNotFoundError('설문을 찾지 못했어요.')
}

async function requireStatus(
  db: D1Database,
  id: string,
  expected: SurveyStatus,
): Promise<void> {
  const row = await db
    .prepare('SELECT status FROM surveys WHERE id = ?')
    .bind(id)
    .first<{ status: SurveyStatus }>()

  if (!row) throw new SurveyNotFoundError('설문을 찾지 못했어요.')
  if (row.status !== expected) {
    throw new SurveyStateError(`이 작업은 ${expected} 상태에서만 할 수 있어요.`)
  }
}

export async function replaceSurveyDraft(
  db: D1Database,
  id: string,
  draft: SurveyDraftInput,
): Promise<void> {
  await requireStatus(db, id, 'draft')

  await db.batch([
    db
      .prepare(
        `UPDATE surveys SET title = ?, description = ?, results_visibility = ? WHERE id = ?`,
      )
      .bind(draft.title, draft.description, draft.resultsVisibility, id),
    // 문항을 먼저 지운다. sections 를 먼저 지우면 ON DELETE CASCADE 가
    // 문항까지 함께 데려가는데, D1 의 외래 키 설정에 기대는 대신 지우는
    // 순서를 여기서 못 박아 둔다.
    db.prepare('DELETE FROM questions WHERE survey_id = ?').bind(id),
    db.prepare('DELETE FROM sections WHERE survey_id = ?').bind(id),
    ...sectionStatements(db, id, draft),
  ])
}

export async function openSurvey(db: D1Database, id: string, nowMs: number): Promise<void> {
  await requireStatus(db, id, 'draft')

  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM questions WHERE survey_id = ?')
    .bind(id)
    .first<{ n: number }>()

  if (!count || count.n === 0) {
    throw new SurveyStateError('문항을 하나 이상 넣어야 설문을 열 수 있어요.')
  }

  await db
    .prepare(`UPDATE surveys SET status = 'open', opened_at = ? WHERE id = ?`)
    .bind(nowMs, id)
    .run()
}

export async function closeSurvey(db: D1Database, id: string, nowMs: number): Promise<void> {
  await requireStatus(db, id, 'open')
  await db
    .prepare(`UPDATE surveys SET status = 'closed', closed_at = ? WHERE id = ?`)
    .bind(nowMs, id)
    .run()
}

/**
 * 마감한 설문을 다시 연다.
 *
 * openSurvey 를 draft|closed 둘 다 받게 넓히지 않는다 — 그 함수는 "문항이
 * 하나도 없으면 못 연다"는, 첫 개방에만 있는 전제를 함께 지고 있다. 이미
 * 한 번 열렸던 설문은 그 검사를 통과한 뒤라 다시 물을 일이 아니다. 전이
 * 하나에 함수 하나라는 이 파일의 모양도 그대로 유지된다.
 *
 * opened_at/closed_at 은 "지금 회차"를 가리킨다: 개방 시각을 새로 찍고
 * 마감 시각을 지운다. 그러지 않으면 열려 있는 설문이 지난 마감 시각을
 * 들고 있게 된다. 이전 회차의 시각은 잃지만, 지금 두 컬럼을 읽는 코드가
 * 없어서 회차 이력 테이블을 새로 두는 것은 과하다.
 */
export async function reopenSurvey(db: D1Database, id: string, nowMs: number): Promise<void> {
  await requireStatus(db, id, 'closed')
  // 예약 마감 시각도 함께 지운다 — 안 지우면 예약 때문에 마감된 설문이
  // 다시 열리는 순간 다음 읽기에 또 마감된다.
  await db
    .prepare(
      `UPDATE surveys SET status = 'open', opened_at = ?, closed_at = NULL, close_at = NULL
       WHERE id = ?`,
    )
    .bind(nowMs, id)
    .run()
}

export async function setResultsVisibility(
  db: D1Database,
  id: string,
  visibility: ResultsVisibility,
): Promise<void> {
  const result = await db
    .prepare('UPDATE surveys SET results_visibility = ? WHERE id = ?')
    .bind(visibility, id)
    .run()

  if (result.meta.changes === 0) throw new SurveyNotFoundError('설문을 찾지 못했어요.')
}

/**
 * 설문을 새 draft 로 복제한다.
 *
 * 문항과 함께 허용 명단도 따라간다. PRODUCT.md 는 도용이 발각됐을 때의
 * 대응을 "설문을 복제해 다시 돌리는 것"으로 정해 두었는데, 바로 그 자리에서
 * 30명을 손으로 다시 적어야 한다면 명단 기능이 없애려던 수고가 그대로
 * 돌아온다.
 *
 * 명부와 응답은 따라가지 않는다 — 복제본은 아직 아무도 내지 않은 새
 * 회차다. 그래서 복제 직후 명단 전원이 미참가로 선다.
 */
export async function duplicateSurvey(
  db: D1Database,
  id: string,
  nowMs: number,
): Promise<string> {
  const original = await getSurvey(db, id)
  if (!original) throw new SurveyNotFoundError('설문을 찾지 못했어요.')

  const allowlist = await getAllowlist(db, id)

  // ID 참조를 인덱스 참조로 되돌리는 일은 관리자 화면도 똑같이 한다 —
  // 두 곳에 따로 적으면 한쪽만 고쳐져 규칙이 조용히 사라진다(§surveyToDraft).
  const draft = surveyToDraft(original)

  const copyId = await createSurvey(
    db,
    { ...draft, title: `${original.title} (사본)` },
    nowMs,
  )

  if (allowlist.length > 0) await replaceAllowlist(db, copyId, allowlist)

  return copyId
}
