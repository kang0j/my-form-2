import { Hono } from 'hono'
import { z } from 'zod'
import { submissionSchema, type SurveyDef } from '../../shared/schema'
import { validateSubmission } from '../../shared/validation'
import { aggregateSurvey } from '../aggregate'
import { isAllowed } from '../db/allowlist'
import { getSurvey } from '../db/surveys'
import { findSubmissionIds } from '../db/receipts'
import { recordSubmission, replaceSubmission } from '../db/submit'
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

/**
 * 제출과 수정은 같은 문으로 들어온다 — 검증·허용 명단 게이트를 두 벌로
 * 나누면 언젠가 한쪽만 고쳐진다. 갈라지는 곳은 그 둘을 다 지난 뒤 한 군데다.
 */
const editSchema = z.object({
  replaces: z.string().min(1).max(64).optional(),
})

publicRoutes.post('/surveys/:id/submit', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  const raw = await c.req.json().catch(() => null)
  const parsed = submissionSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: '제출 형식이 맞지 않아요.', errors: ['제출 형식이 맞지 않아요.'] }, 400)
  }

  // `replaces` 는 submissionSchema 밖에 있다. 그 스키마는 "무엇을 답했는가"의
  // 모양이고 validateSubmission 이 보는 것도 그것뿐이다 — 어느 응답을 갈아
  // 끼우는지는 답의 일부가 아니라 이 요청의 방향이다. zod 의 object 는 모르는
  // 키를 조용히 버리므로 원본에서 따로 읽는다.
  const editParse = editSchema.safeParse(raw)
  if (!editParse.success) {
    return c.json({ error: '제출 형식이 맞지 않아요.', errors: ['제출 형식이 맞지 않아요.'] }, 400)
  }
  const replaces = editParse.data.replaces

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

  const meta = {
    ip: c.req.header('CF-Connecting-IP') ?? '',
    userAgent: c.req.header('User-Agent') ?? '',
    nowMs: Date.now(),
  }

  // 응답 수정. `replaces` 가 붙어 오면 새 응답을 만들지 않고 그 응답 하나를
  // 갈아 끼운다. 설문이 열려 있을 때만 오는데, 그 문은 위 validateSubmission
  // 이 이미 지킨다(status !== 'open' 이면 여기까지 오지 못한다).
  if (replaces) {
    const result = await replaceSubmission(
      c.env.DB,
      c.env.HMAC_SECRET,
      survey,
      parsed.data,
      meta,
      replaces,
    )

    if (!result.ok) {
      // 어느 문에서 막혔는지는 구분해서 말한다 — 두 경우에 사람이 할 일이
      // 다르다. 응답 쪽이 막힌 것은 이 기기의 응답이 아니라는 뜻이라
      // 고칠 방법이 없고(추가 제출로 가야 한다), 명부 쪽이 막힌 것은
      // 이름·학번을 처음 낼 때와 다르게 적었다는 뜻이라 고칠 수 있다.
      const message =
        result.reason === 'submission'
          ? '이 기기에서 낸 응답이 아니라 수정할 수 없어요.'
          : '처음 낼 때 적은 이름·학번과 달라요. 그대로 적어 주세요.'
      return c.json({ error: message, errors: [message] }, 403)
    }

    // 수정에는 신원 중복 경고를 붙이지 않는다. 명부에 줄을 더하지 않고
    // 이미 있던 줄을 고쳐 쓰므로, 같은 이름이 두 번 세어지는 일 자체가 없다.
    return c.json({ ok: true, duplicateIdentity: false, submissionId: result.submissionId })
  }

  const outcome = await recordSubmission(c.env.DB, c.env.HMAC_SECRET, survey, parsed.data, meta)

  // 응답 ID 를 돌려준다. 낸 사람이 자기 응답에 붙은 번호를 확인할 수 있게
  // 하는 영수증이지, 신원과의 연결이 아니다 — 이 ID 로 닿는 곳은 응답
  // (submissions/answers)뿐이고 명부에는 이 값이 어디에도 없다.
  return c.json({
    ok: true,
    duplicateIdentity: outcome.duplicateIdentity,
    submissionId: outcome.submissionId,
  })
})

/**
 * 이 기기가 이 설문에 낸 응답 ID 를 되묻는다.
 *
 * 제출 직후에는 위 /submit 의 답에 ID 가 실려 오므로 이 경로가 필요 없다.
 * 이 기능이 생기기 전에 낸 기기에는 "냈다"는 표시만 남아 있어서(§client/
 * storage) ID 를 되살릴 길이 그 기기의 브라우저 키뿐이다.
 *
 * /check 와 같은 이유로 POST 다 — 브라우저 키를 URL 에 실으면 접근 로그·
 * 리퍼러·히스토리에 그대로 남는다.
 */
const receiptSchema = z.object({
  browserKey: z.string().min(8).max(200),
})

publicRoutes.post('/surveys/:id/receipts', async (c) => {
  const survey = await getSurvey(c.env.DB, c.req.param('id'))
  if (!survey) return c.json({ error: '설문을 찾지 못했어요.' }, 404)

  const parsed = receiptSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '요청 형식이 맞지 않아요.' }, 400)

  return c.json({
    submissionIds: await findSubmissionIds(
      c.env.DB,
      c.env.HMAC_SECRET,
      survey.id,
      parsed.data.browserKey,
    ),
  })
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
