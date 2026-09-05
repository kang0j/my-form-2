import { Hono } from 'hono'
import { z } from 'zod'
import { checkRules } from '../../shared/rules'
import { surveyDraftSchema, type SurveyDef } from '../../shared/schema'
import { requireAdmin } from '../access'
import { aggregateSurvey } from '../aggregate'
import { buildResponsesCsv, buildRosterCsv } from '../csv'
import { getAllowlist, getRoster, replaceAllowlist } from '../db/allowlist'
import { getAuditReport } from '../db/audit'
import { countSubmissions, getAnswerRows } from '../db/results'
import {
  closeSurvey,
  createSurvey,
  deleteSurvey,
  duplicateSurvey,
  getSurvey,
  listSurveys,
  openSurvey,
  reopenSurvey,
  replaceSurveyDraft,
  setCloseAt,
  setResultsVisibility,
} from '../db/surveys'

export const adminRoutes = new Hono<{ Bindings: Env }>()

adminRoutes.use('*', requireAdmin)

adminRoutes.get('/surveys', async (c) => c.json(await listSurveys(c.env.DB)))

adminRoutes.post('/surveys', async (c) => {
  const parsed = surveyDraftSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '설문 내용이 맞지 않아요.' }, 400)

  const ruleProblems = checkRules(parsed.data)
  if (ruleProblems.length > 0) return c.json({ error: ruleProblems[0] }, 400)

  const id = await createSurvey(c.env.DB, parsed.data, Date.now())
  return c.json({ id })
})

adminRoutes.get('/surveys/:id', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)
  return c.json(survey)
})

adminRoutes.put('/surveys/:id', async (c) => {
  const parsed = surveyDraftSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '설문 내용이 맞지 않아요.' }, 400)

  const ruleProblems = checkRules(parsed.data)
  if (ruleProblems.length > 0) return c.json({ error: ruleProblems[0] }, 400)

  await replaceSurveyDraft(c.env.DB, c.req.param('id'), parsed.data)
  return c.json({ ok: true })
})

adminRoutes.post('/surveys/:id/open', async (c) => {
  await openSurvey(c.env.DB, c.req.param('id'), Date.now())
  return c.json({ ok: true })
})

adminRoutes.post('/surveys/:id/close', async (c) => {
  await closeSurvey(c.env.DB, c.req.param('id'), Date.now())
  return c.json({ ok: true })
})

adminRoutes.post('/surveys/:id/reopen', async (c) => {
  await reopenSurvey(c.env.DB, c.req.param('id'), Date.now())
  return c.json({ ok: true })
})

const visibilitySchema = z.object({
  resultsVisibility: z.enum(['admin', 'after_close']),
})

adminRoutes.post('/surveys/:id/visibility', async (c) => {
  const parsed = visibilitySchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '결과 공개 설정이 맞지 않아요.' }, 400)

  await setResultsVisibility(c.env.DB, c.req.param('id'), parsed.data.resultsVisibility)
  return c.json({ ok: true })
})

/**
 * 예약 마감.
 *
 * 시각은 밀리초로 받는다 — 관리자 화면이 datetime-local 로 받은 값을
 * 브라우저의 시간대로 해석해 보내고, 서버는 그 절대 시각만 들고 있는다.
 * null 은 예약 해제다.
 *
 * 상한은 대충 100년 뒤로 둔다. 초 단위로 잘못 보낸 값(1e9 언저리)은
 * 1970년대가 되어 곧바로 마감되는데, 그건 막을 수 없다 — 지난 시각을
 * 넣는 것 자체는 정상 사용이기 때문이다(§setCloseAt).
 */
const scheduleSchema = z.object({
  closeAt: z.number().int().min(0).max(4102444800000).nullable(),
})

adminRoutes.post('/surveys/:id/schedule', async (c) => {
  const parsed = scheduleSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '마감 시각이 맞지 않아요.' }, 400)

  await setCloseAt(c.env.DB, c.req.param('id'), parsed.data.closeAt)
  return c.json({ ok: true })
})

adminRoutes.delete('/surveys/:id', async (c) => {
  await deleteSurvey(c.env.DB, c.req.param('id'))
  return c.json({ ok: true })
})

adminRoutes.post('/surveys/:id/duplicate', async (c) => {
  const id = await duplicateSurvey(c.env.DB, c.req.param('id'), Date.now())
  return c.json({ id })
})

/**
 * 마감 전에는 관리자에게도 집계를 주지 않는다.
 *
 * 관리자만 보는 화면이라도, 진행 중에 두 번 읽으면 그 사이 들어온 한 표가
 * 델타로 드러난다. 참가자 화면이 그 사이 누가 들어왔는지 이름과 시각으로
 * 말해 주므로 두 값을 맞추면 한 사람의 답이 특정된다. answers 에 시각
 * 컬럼을 두지 않은 것(§0001_init.sql)은 바로 이 대조를 막기 위한 것인데,
 * 살아 있는 API 를 반복해 부르는 것 자체가 그 시간축을 되살린다. 그래서
 * 집계는 마감된 뒤 한 번만 열린다.
 */
function requireClosedForResults(survey: SurveyDef): string | null {
  return survey.status === 'closed'
    ? null
    : '마감한 뒤에 결과를 볼 수 있어요. 진행 중에 집계를 보면 그 사이 들어온 한 표가 누구 것인지 드러날 수 있어요.'
}

adminRoutes.get('/surveys/:id/results', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  const locked = requireClosedForResults(survey)
  if (locked) return c.json({ error: locked }, 409)

  const rows = await getAnswerRows(c.env.DB, survey.id)
  return c.json({
    title: survey.title,
    submissionCount: await countSubmissions(c.env.DB, survey.id),
    results: aggregateSurvey(survey, rows),
  })
})

adminRoutes.get('/surveys/:id/audit', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)
  return c.json(await getAuditReport(c.env.DB, survey.id))
})

/**
 * 허용 명단.
 *
 * 설문 상태로 잠그지 않는다 — 문항과 달리 명단은 진행 중에 고치는 것이
 * 정상 사용이다(빠진 사람 한 명 추가). 마감 뒤에도 막을 이유가 없어
 * 그냥 열어 둔다.
 */
const allowlistSchema = z.object({
  entries: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(50),
        studentId: z.string().trim().min(1).max(30),
      }),
    )
    .max(1000),
})

adminRoutes.get('/surveys/:id/allowlist', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)
  return c.json({ entries: await getAllowlist(c.env.DB, survey.id) })
})

adminRoutes.put('/surveys/:id/allowlist', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  const parsed = allowlistSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '명단이 맞지 않아요.' }, 400)

  await replaceAllowlist(c.env.DB, survey.id, parsed.data.entries)
  return c.json({ ok: true })
})

/** 명단과 명부를 대조한 참가 현황. 마감 전에 누가 아직 안 냈는지 보는 화면이 읽는다. */
adminRoutes.get('/surveys/:id/roster', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)
  return c.json(await getRoster(c.env.DB, survey.id))
})

adminRoutes.get('/surveys/:id/export', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  const type = c.req.query('type')
  let csv: string
  let filename: string

  if (type === 'responses') {
    // 응답 CSV 는 집계보다 더 날것이다 — 같은 잠금을 건다.
    const locked = requireClosedForResults(survey)
    if (locked) return c.json({ error: locked }, 409)
    csv = buildResponsesCsv(survey, await getAnswerRows(c.env.DB, survey.id))
    filename = 'responses.csv'
  } else if (type === 'roster') {
    const report = await getAuditReport(c.env.DB, survey.id)
    csv = buildRosterCsv(report.participants)
    filename = 'roster.csv'
  } else {
    return c.json({ error: '내보낼 종류를 골라 주세요.' }, 400)
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
