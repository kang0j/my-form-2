import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SurveyDraftInput } from '../../src/shared/schema'
import { getAllowlist, getRoster, isAllowed, replaceAllowlist } from '../../src/server/db/allowlist'
import { createSurvey, duplicateSurvey, openSurvey } from '../../src/server/db/surveys'

const NOW = Date.UTC(2026, 8, 4, 1, 0)

const draft: SurveyDraftInput = {
  title: '동아리 회장 선거',
  description: '',
  resultsVisibility: 'admin',
  sections: [{ questions: [
    {
      type: 'single',
      title: '누구를 지지하나요?',
      description: '',
      required: true,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [{ label: '후보 A', isOther: false }],
    },
  ] }],
}

let surveyId = ''

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM surveys').run()
  surveyId = await createSurvey(env.DB, draft, NOW)
  await openSurvey(env.DB, surveyId, NOW)
})

/** 명부에 한 사람을 넣는다. 응답 섬은 건드리지 않는다 — 이 모듈은 명부만 본다. */
async function addParticipant(name: string, studentId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO participants (id, survey_id, name, student_id, submitted_at, ip_hash, ua_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), surveyId, name, studentId, NOW, 'iphash', 'uahash')
    .run()
}

describe('replaceAllowlist / getAllowlist', () => {
  it('명단을 저장하고 이름 순으로 돌려준다', async () => {
    await replaceAllowlist(env.DB, surveyId, [
      { name: '홍길동', studentId: '20250002' },
      { name: '김서연', studentId: '20250001' },
    ])

    expect(await getAllowlist(env.DB, surveyId)).toEqual([
      { name: '김서연', studentId: '20250001' },
      { name: '홍길동', studentId: '20250002' },
    ])
  })

  it('저장할 때 신원을 정규화한다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: ' 홍  길동 ', studentId: ' 20250001 ' }])
    expect(await getAllowlist(env.DB, surveyId)).toEqual([
      { name: '홍 길동', studentId: '20250001' },
    ])
  })

  // 붙여넣은 명부에 같은 줄이 두 번 들어 있는 것은 흔한 일이고, 관리자가
  // 고치라고 돌려보낼 만한 잘못이 아니다. 조용히 하나로 접는다.
  it('정규화하면 같아지는 줄은 하나로 접는다', async () => {
    await replaceAllowlist(env.DB, surveyId, [
      { name: '홍길동', studentId: '20250001' },
      { name: ' 홍길동', studentId: '20250001 ' },
    ])
    expect(await getAllowlist(env.DB, surveyId)).toHaveLength(1)
  })

  it('다시 저장하면 이전 명단을 대체한다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    await replaceAllowlist(env.DB, surveyId, [{ name: '김서연', studentId: '20250002' }])

    expect(await getAllowlist(env.DB, surveyId)).toEqual([
      { name: '김서연', studentId: '20250002' },
    ])
  })

  it('빈 배열로 저장하면 명단이 사라진다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    await replaceAllowlist(env.DB, surveyId, [])
    expect(await getAllowlist(env.DB, surveyId)).toEqual([])
  })

  // 설문 간 명단이 새지 않아야 한다.
  it('다른 설문의 명단과 섞이지 않는다', async () => {
    const other = await createSurvey(env.DB, draft, NOW)
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    await replaceAllowlist(env.DB, other, [{ name: '김서연', studentId: '20250002' }])

    expect(await getAllowlist(env.DB, surveyId)).toEqual([
      { name: '홍길동', studentId: '20250001' },
    ])
  })
})

describe('isAllowed', () => {
  // 이 설정이 없던 시절에 만들어진 설문과, 명단을 쓸 생각이 없는 관리자를
  // 위한 기본값이다. 명단이 비었다는 것은 "아무도 못 들어온다"가 아니라
  // "제한하지 않는다"는 뜻이어야 한다.
  it('명단이 비어 있으면 누구나 통과한다', async () => {
    expect(await isAllowed(env.DB, surveyId, { name: '아무개', studentId: '99999999' })).toBe(true)
  })

  it('명단에 있으면 통과한다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    expect(await isAllowed(env.DB, surveyId, { name: '홍길동', studentId: '20250001' })).toBe(true)
  })

  it('명단에 없으면 막힌다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    expect(await isAllowed(env.DB, surveyId, { name: '김서연', studentId: '20250002' })).toBe(false)
  })

  it('공백·자모 분리가 달라도 같은 사람으로 통과시킨다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    expect(
      await isAllowed(env.DB, surveyId, {
        name: `  ${'홍길동'.normalize('NFD')} `,
        studentId: '20250001',
      }),
    ).toBe(true)
  })

  it('이름만 맞고 학번이 다르면 막힌다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    expect(await isAllowed(env.DB, surveyId, { name: '홍길동', studentId: '20250009' })).toBe(false)
  })

  it('다른 설문의 명단으로는 통과하지 못한다', async () => {
    const other = await createSurvey(env.DB, draft, NOW)
    await replaceAllowlist(env.DB, other, [{ name: '홍길동', studentId: '20250001' }])
    await replaceAllowlist(env.DB, surveyId, [{ name: '김서연', studentId: '20250002' }])

    expect(await isAllowed(env.DB, surveyId, { name: '홍길동', studentId: '20250001' })).toBe(false)
  })
})

describe('getRoster', () => {
  it('명단이 없으면 제한이 꺼진 것으로 알린다', async () => {
    await addParticipant('홍길동', '20250001')
    const roster = await getRoster(env.DB, surveyId)

    expect(roster.enabled).toBe(false)
    expect(roster.notParticipated).toEqual([])
  })

  it('명단을 참가·미참가로 가른다', async () => {
    await replaceAllowlist(env.DB, surveyId, [
      { name: '홍길동', studentId: '20250001' },
      { name: '김서연', studentId: '20250002' },
      { name: '박도현', studentId: '20250003' },
    ])
    await addParticipant('홍길동', '20250001')

    const roster = await getRoster(env.DB, surveyId)
    expect(roster.enabled).toBe(true)
    expect(roster.participated).toEqual([{ name: '홍길동', studentId: '20250001' }])
    expect(roster.notParticipated).toEqual([
      { name: '김서연', studentId: '20250002' },
      { name: '박도현', studentId: '20250003' },
    ])
  })

  // 명부에는 정규화 전 값이 남아 있을 수 있다(이 기능이 생기기 전에 들어온
  // 제출). 그것 때문에 이미 낸 사람이 미참가로 뜨면 관리자가 헛 연락을 한다.
  it('명부의 표기가 달라도 정규화해서 맞춘다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍 길동', studentId: '20250001' }])
    await addParticipant('홍  길동 ', ' 20250001')

    const roster = await getRoster(env.DB, surveyId)
    expect(roster.participated).toEqual([{ name: '홍 길동', studentId: '20250001' }])
    expect(roster.notParticipated).toEqual([])
  })

  // 명단을 나중에 붙였거나 명단 없이 열어 둔 동안 들어온 제출. 관리자가
  // 이걸 못 보면 "참가 3명인데 명부는 4명"이라는 모순만 보고 이유를 모른다.
  it('명단에 없는 제출을 따로 모아 보여준다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    await addParticipant('홍길동', '20250001')
    await addParticipant('낯선이', '20259999')

    const roster = await getRoster(env.DB, surveyId)
    expect(roster.unlisted).toEqual([{ name: '낯선이', studentId: '20259999' }])
  })

  it('같은 사람이 두 번 제출해도 참가 목록에 한 번만 넣는다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    await addParticipant('홍길동', '20250001')
    await addParticipant('홍길동', '20250001')

    const roster = await getRoster(env.DB, surveyId)
    expect(roster.participated).toEqual([{ name: '홍길동', studentId: '20250001' }])
  })
})

describe('설문을 복제할 때', () => {
  // PRODUCT.md 는 도용이 발각됐을 때의 대응을 "설문을 복제해 다시 돌리는
  // 것"으로 정해 두었다. 그 자리에서 30명을 손으로 다시 적어야 한다면
  // 이 기능이 없애려던 수고가 그대로 돌아온다.
  it('허용 명단도 함께 복제한다', async () => {
    await replaceAllowlist(env.DB, surveyId, [
      { name: '홍길동', studentId: '20250001' },
      { name: '김서연', studentId: '20250002' },
    ])

    const copyId = await duplicateSurvey(env.DB, surveyId, NOW + 1000)

    expect(await getAllowlist(env.DB, copyId)).toEqual([
      { name: '김서연', studentId: '20250002' },
      { name: '홍길동', studentId: '20250001' },
    ])
  })

  // 명부는 따라오지 않는다 — 복제본은 아무도 아직 내지 않은 새 회차다.
  it('복제본에서는 명단 전원이 미참가다', async () => {
    await replaceAllowlist(env.DB, surveyId, [{ name: '홍길동', studentId: '20250001' }])
    await addParticipant('홍길동', '20250001')

    const copyId = await duplicateSurvey(env.DB, surveyId, NOW + 1000)
    const roster = await getRoster(env.DB, copyId)

    expect(roster.participated).toEqual([])
    expect(roster.notParticipated).toEqual([{ name: '홍길동', studentId: '20250001' }])
  })

  it('명단이 없던 설문의 복제본에도 명단이 없다', async () => {
    const copyId = await duplicateSurvey(env.DB, surveyId, NOW + 1000)
    expect(await getAllowlist(env.DB, copyId)).toEqual([])
  })
})
