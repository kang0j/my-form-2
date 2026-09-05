import { Hono } from 'hono'
import { z } from 'zod'
import { submissionSchema, type SurveyDef } from '../../shared/schema'
import { validateSubmission } from '../../shared/validation'
import { aggregateSurvey } from '../aggregate'
import { isAllowed } from '../db/allowlist'
import { getSurvey } from '../db/surveys'
import { recordSubmission } from '../db/submit'
import { countSubmissions, getAnswerRows } from '../db/results'

/**
 * 마감 전에는 어느 쪽도 열리지 않는다. 'admin' 은 마감 뒤에도 관리자에게만
 * 보인다는 뜻이고, 'after_close' 는 마감 뒤 모두에게 보인다는 뜻이다
 * (§ResultsVisibility).
 */
export function isResultsPublic(survey: SurveyDef): boolean {
  switch (survey.resultsVisibility) {
    case 'admin':
      return false
    case 'after_close':
      return survey.status === 'closed'
  }
}

export const publicRoutes = new Hono<{ Bindings: Env }>()

publicRoutes.get('/surveys/:id', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  return c.json({
    id: survey.id,
    title: survey.title,
    description: survey.description,
    status: survey.status,
    resultsVisibility: survey.resultsVisibility,
    resultsAvailable: isResultsPublic(survey),
    // 예약 마감 시각은 감출 것이 아니다 — 언제까지 낼 수 있는지는 내는
    // 사람이 알아야 하는 사실이다.
    closeAt: survey.closeAt,
    sections: survey.status === 'open' ? survey.sections : [],
  })
})

/**
 * 표지에서 이름·학번을 적고 「시작하기」를 누를 때 부른다.
 *
 * 문항을 다 푼 뒤에 거부당하면 인앱 브라우저에서 되돌릴 방법이 마땅치
 * 않으므로, 들어서기 전에 먼저 묻는다. 다만 이 답은 편의일 뿐이고 진짜
 * 권위는 아래 submit 의 재검사다 — 표지를 건너뛰고 submit 을 직접 부를 수
 * 있기 때문이다.
 *
 * GET 이 아니라 POST 인 것은 이름·학번을 URL 에 싣지 않기 위해서다(접근
 * 로그·리퍼러·브라우저 히스토리에 신원이 남는다).
 */
const identityCheckSchema = z.object({
  name: z.string().trim().min(1).max(50),
  studentId: z.string().trim().min(1).max(30),
})

publicRoutes.post('/surveys/:id/check', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  const parsed = identityCheckSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '이름과 학번을 적어 주세요.' }, 400)

  return c.json({ allowed: await isAllowed(c.env.DB, survey.id, parsed.data) })
})

publicRoutes.post('/surveys/:id/submit', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  const raw = await c.req.json().catch(() => null)
  const parsed = submissionSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: '제출 형식이 맞지 않아요.', errors: ['제출 형식이 맞지 않아요.'] }, 400)
  }

  const validation = validateSubmission(survey, parsed.data)
  if (!validation.ok) {
    return c.json({ error: validation.errors[0], errors: validation.errors }, 400)
  }

  // 허용 명단 게이트의 진짜 자리. 표지의 /check 는 문항에 들어서기 전에
  // 알려주는 편의일 뿐이고, 그것만으로는 이 엔드포인트를 직접 부르는 것을
  // 막지 못한다. 답 검증 뒤에 두는 것은 형식이 깨진 요청과 "명단에 없다"를
  // 섞어 답하지 않기 위해서다.
  if (!(await isAllowed(c.env.DB, survey.id, parsed.data))) {
    const message = '명단에 없는 이름·학번이에요. 관리자에게 확인해 주세요.'
    return c.json({ error: message, errors: [message] }, 403)
  }

  const outcome = await recordSubmission(c.env.DB, c.env.HMAC_SECRET, survey, parsed.data, {
    ip: c.req.header('CF-Connecting-IP') ?? '',
    userAgent: c.req.header('User-Agent') ?? '',
    nowMs: Date.now(),
  })

  return c.json({ ok: true, duplicateIdentity: outcome.duplicateIdentity })
})

publicRoutes.get('/surveys/:id/results', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)
  if (!isResultsPublic(survey)) {
    return c.json({ error: '아직 결과를 볼 수 없어요.' }, 403)
  }

  const rows = await getAnswerRows(c.env.DB, survey.id)

  return c.json({
    title: survey.title,
    submissionCount: await countSubmissions(c.env.DB, survey.id),
    results: aggregateSurvey(survey, rows),
  })
})
