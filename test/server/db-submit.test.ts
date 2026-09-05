import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SurveyDef, SubmissionInput } from '../../src/shared/schema'
import { createSurvey, getSurvey, openSurvey } from '../../src/server/db/surveys'
import { recordSubmission } from '../../src/server/db/submit'
import { getAnswerRows, countSubmissions } from '../../src/server/db/results'

const NOW = Date.UTC(2026, 8, 2, 1, 0)
const META = { ip: '203.0.113.7', userAgent: 'test-agent', nowMs: NOW }
const SECRET = 'test-secret'

let survey: SurveyDef

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM surveys').run()

  const id = await createSurvey(
    env.DB,
    {
      title: '설문',
      description: '',
      resultsVisibility: 'after_close',
      sections: [{ questions: [
        {
          type: 'multi',
          title: '다중',
          description: '',
          required: false,
          minSelect: null,
          maxSelect: null,
          allowOther: true,
          options: [
            { label: 'A', isOther: false },
            { label: '기타', isOther: true },
          ],
        },
        {
          type: 'ranking',
          title: '랭킹',
          description: '',
          required: false,
          minSelect: null,
          maxSelect: null,
          allowOther: false,
          options: [
            { label: '가', isOther: false },
            { label: '나', isOther: false },
          ],
        },
        {
          type: 'text',
          title: '주관식',
          description: '',
          required: false,
          minSelect: null,
          maxSelect: null,
          allowOther: false,
          options: [],
        },
      ] }],
    },
    NOW,
  )
  await openSurvey(env.DB, id, NOW)
  survey = (await getSurvey(env.DB, id))!
})

function fullSubmission(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  const [multi, ranking, text] = survey.sections[0].questions
  return {
    name: '홍길동',
    studentId: '20250001',
    browserKey: 'browser-key-1',
    answers: [
      {
        questionId: multi.id,
        type: 'multi',
        optionIds: [multi.options[0].id, multi.options[1].id],
        otherText: '직접 입력',
      },
      {
        questionId: ranking.id,
        type: 'ranking',
        order: [ranking.options[1].id, ranking.options[0].id],
      },
      { questionId: text.id, type: 'text', text: '한마디' },
    ],
    ...overrides,
  }
}

describe('recordSubmission', () => {
  it('명부와 응답을 함께 기록한다', async () => {
    await recordSubmission(env.DB, SECRET, survey, fullSubmission(), META)

    const participants = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM participants WHERE survey_id = ?')
      .bind(survey.id)
      .first<{ n: number }>()
    expect(participants!.n).toBe(1)
    expect(await countSubmissions(env.DB, survey.id)).toBe(1)
  })

  it('선택한 보기마다 한 행씩 만든다', async () => {
    await recordSubmission(env.DB, SECRET, survey, fullSubmission(), META)
    const rows = await getAnswerRows(env.DB, survey.id)

    const [multi, ranking, text] = survey.sections[0].questions
    expect(rows.filter((r) => r.questionId === multi.id)).toHaveLength(2)
    expect(rows.filter((r) => r.questionId === ranking.id)).toHaveLength(2)
    expect(rows.filter((r) => r.questionId === text.id)).toHaveLength(1)
  })

  it('기타 입력은 기타 보기 행에만 담는다', async () => {
    await recordSubmission(env.DB, SECRET, survey, fullSubmission(), META)
    const rows = await getAnswerRows(env.DB, survey.id)
    const [multi] = survey.sections[0].questions

    const plain = rows.find((r) => r.optionId === multi.options[0].id)
    const other = rows.find((r) => r.optionId === multi.options[1].id)
    expect(plain!.textValue).toBeNull()
    expect(other!.textValue).toBe('직접 입력')
  })

  it('랭킹은 순서대로 1부터 순위를 매긴다', async () => {
    await recordSubmission(env.DB, SECRET, survey, fullSubmission(), META)
    const rows = await getAnswerRows(env.DB, survey.id)
    const [, ranking] = survey.sections[0].questions

    const first = rows.find((r) => r.optionId === ranking.options[1].id)
    const second = rows.find((r) => r.optionId === ranking.options[0].id)
    expect(first!.rankPosition).toBe(1)
    expect(second!.rankPosition).toBe(2)
  })

  it('원본 브라우저 키·IP·UA 를 저장하지 않는다', async () => {
    await recordSubmission(env.DB, SECRET, survey, fullSubmission(), META)

    const submission = await env.DB
      .prepare('SELECT browser_key_hash FROM submissions WHERE survey_id = ?')
      .bind(survey.id)
      .first<{ browser_key_hash: string }>()
    expect(submission!.browser_key_hash).not.toBe('browser-key-1')
    expect(submission!.browser_key_hash).toMatch(/^[0-9a-f]{64}$/)

    const participant = await env.DB
      .prepare('SELECT ip_hash, ua_hash FROM participants WHERE survey_id = ?')
      .bind(survey.id)
      .first<{ ip_hash: string; ua_hash: string }>()
    expect(participant!.ip_hash).not.toBe('203.0.113.7')
    expect(participant!.ua_hash).not.toBe('test-agent')
  })

  it('같은 이름·학번이 이미 있으면 duplicateIdentity 를 알린다', async () => {
    const first = await recordSubmission(env.DB, SECRET, survey, fullSubmission(), META)
    expect(first.duplicateIdentity).toBe(false)

    const second = await recordSubmission(env.DB, SECRET, survey, fullSubmission(), META)
    expect(second.duplicateIdentity).toBe(true)
    expect(await countSubmissions(env.DB, survey.id)).toBe(2)
  })

  it('빈 주관식은 행을 만들지 않는다', async () => {
    const [, , text] = survey.sections[0].questions
    await recordSubmission(
      env.DB,
      SECRET,
      survey,
      fullSubmission({ answers: [{ questionId: text.id, type: 'text', text: '   ' }] }),
      META,
    )
    expect(await getAnswerRows(env.DB, survey.id)).toHaveLength(0)
  })
})

describe('원자성', () => {
  it('응답 기록이 실패하면 명부도 남지 않는다', async () => {
    // 존재하지 않는 문항 ID 는 answers 의 외래키를 위반해 배치 전체를 되돌린다.
    const broken = fullSubmission({
      answers: [{ questionId: 'ghost-question', type: 'text', text: '내용' }],
    })

    await expect(
      recordSubmission(env.DB, SECRET, survey, broken, META),
    ).rejects.toThrow()

    const participants = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM participants WHERE survey_id = ?')
      .bind(survey.id)
      .first<{ n: number }>()
    expect(participants!.n).toBe(0)
    expect(await countSubmissions(env.DB, survey.id)).toBe(0)
  })
})

describe('삽입 순서 누출 방지', () => {
  it('응답 조회는 ID 순으로만 정렬한다', async () => {
    for (let i = 0; i < 10; i++) {
      await recordSubmission(
        env.DB,
        SECRET,
        survey,
        fullSubmission({ name: `사람${i}`, studentId: `2025000${i}` }),
        META,
      )
    }

    const rows = await getAnswerRows(env.DB, survey.id)
    const seen: string[] = []
    for (const r of rows) if (!seen.includes(r.submissionId)) seen.push(r.submissionId)

    expect(seen).toEqual([...seen].sort())
  })

  it('제출 순서와 조회 순서가 일치하지 않는다', async () => {
    // 랜덤 UUID 10개의 정렬 순서가 삽입 순서와 우연히 같을 확률은 1/10! 이다.
    const inserted: string[] = []
    for (let i = 0; i < 10; i++) {
      const outcome = await recordSubmission(
        env.DB,
        SECRET,
        survey,
        fullSubmission({ name: `사람${i}`, studentId: `2025000${i}` }),
        META,
      )
      inserted.push(outcome.submissionId)
    }

    const rows = await getAnswerRows(env.DB, survey.id)
    const seen: string[] = []
    for (const r of rows) if (!seen.includes(r.submissionId)) seen.push(r.submissionId)

    expect(seen).not.toEqual(inserted)
  })
})

describe('명부-응답 값 비연결성', () => {
  // 스키마의 컬럼 이름만 보는 검사(schema.test.ts)는 값 자체가 양쪽에 새는 결함을
  // 잡지 못한다. participantId 와 submissionId 를 같은 newId() 호출로 합치는 실수는
  // tsc 도, 스키마 검사도, 나머지 198개 테스트도 통과시킨다. 이 테스트는 실제 저장된
  // '값'을 놓고 두 섬 사이에 survey.id 외에 공유되는 값이 없는지를 직접 확인한다.

  async function allValuesOf(table: 'participants' | 'submissions'): Promise<Set<string>> {
    const { results } = await env.DB
      .prepare(`SELECT * FROM ${table} WHERE survey_id = ?`)
      .bind(survey.id)
      .all<Record<string, unknown>>()

    const values = new Set<string>()
    for (const row of results) {
      for (const v of Object.values(row)) {
        if (v !== null && v !== undefined) values.add(String(v))
      }
    }
    return values
  }

  async function allAnswerValuesOf(surveyId: string): Promise<Set<string>> {
    const { results } = await env.DB
      .prepare(
        `SELECT a.* FROM answers a
         JOIN submissions s ON s.id = a.submission_id
         WHERE s.survey_id = ?`,
      )
      .bind(surveyId)
      .all<Record<string, unknown>>()

    const values = new Set<string>()
    for (const row of results) {
      for (const v of Object.values(row)) {
        if (v !== null && v !== undefined) values.add(String(v))
      }
    }
    return values
  }

  it('명부 값과 응답 값의 교집합은 survey.id 뿐이다', async () => {
    await recordSubmission(
      env.DB,
      SECRET,
      survey,
      fullSubmission({
        name: 'ZZ-NAME',
        studentId: 'ZZ-SID',
        browserKey: 'ZZ-KEY',
        answers: [{ questionId: survey.sections[0].questions[2].id, type: 'text', text: 'ZZ-TEXT' }],
      }),
      { ip: 'ZZ-IP', userAgent: 'ZZ-UA', nowMs: NOW },
    )

    const participantValues = await allValuesOf('participants')
    const submissionValues = await allValuesOf('submissions')
    const answerValues = await allAnswerValuesOf(survey.id)

    const responseValues = new Set([...submissionValues, ...answerValues])
    const intersection = [...participantValues].filter((v) => responseValues.has(v))

    expect(intersection).toEqual([survey.id])
  })

  it('원본 명부 값은 응답 쪽 어디에도 부분 문자열로도 나타나지 않는다', async () => {
    await recordSubmission(
      env.DB,
      SECRET,
      survey,
      fullSubmission({
        name: 'ZZ-NAME',
        studentId: 'ZZ-SID',
        browserKey: 'ZZ-KEY',
        answers: [{ questionId: survey.sections[0].questions[2].id, type: 'text', text: 'ZZ-TEXT' }],
      }),
      { ip: 'ZZ-IP', userAgent: 'ZZ-UA', nowMs: NOW },
    )

    const submissionValues = await allValuesOf('submissions')
    const answerValues = await allAnswerValuesOf(survey.id)
    const responseText = [...submissionValues, ...answerValues].join('\n')

    for (const secret of ['ZZ-NAME', 'ZZ-SID', 'ZZ-KEY', 'ZZ-IP', 'ZZ-UA']) {
      expect(responseText).not.toContain(secret)
    }
    expect(responseText).toContain('ZZ-TEXT')

    const participantValues = await allValuesOf('participants')
    const participantText = [...participantValues].join('\n')
    expect(participantText).not.toContain('ZZ-TEXT')
  })
})

describe('명부에 저장하는 신원', () => {
  // 명부의 표기가 제각각이면 허용 명단 대조(§getRoster)와 신원 중복 탐지가
  // 둘 다 어긋난다. 정규화는 들어오는 문 한 곳에서 끝내고, 그 뒤 코드는
  // 전부 순수 문자열 비교로 산다.
  it('이름·학번을 정규화해서 넣는다', async () => {
    await recordSubmission(
      env.DB,
      SECRET,
      survey,
      fullSubmission({ name: ' 홍  길동 ', studentId: ' 20250001 ' }),
      META,
    )

    const row = await env.DB
      .prepare('SELECT name, student_id AS studentId FROM participants WHERE survey_id = ?')
      .bind(survey.id)
      .first<{ name: string; studentId: string }>()

    expect(row).toEqual({ name: '홍 길동', studentId: '20250001' })
  })

  it('표기만 다른 같은 사람의 두 번째 제출을 신원 중복으로 본다', async () => {
    await recordSubmission(env.DB, SECRET, survey, fullSubmission({ name: '홍길동' }), META)
    const second = await recordSubmission(
      env.DB,
      SECRET,
      survey,
      fullSubmission({ name: '홍길동'.normalize('NFD') }),
      META,
    )

    expect(second.duplicateIdentity).toBe(true)
  })
})
