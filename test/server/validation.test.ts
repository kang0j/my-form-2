import { describe, expect, it } from 'vitest'
import type { QuestionDef, SurveyDef } from '../../src/shared/schema'
import { validateSubmission } from '../../src/shared/validation'

// 검증은 문항이 어느 화면에 놓였는지 보지 않는다(§allQuestions). 그래서
// 이 헬퍼는 문항 목록만 받고 섹션 한 장에 담는다 — 섹션 경계가 검증에
// 관여하는지는 아래 '섹션' describe 에서 따로 본다.
function survey(
  overrides: Partial<Omit<SurveyDef, 'sections'>> & { questions?: QuestionDef[] } = {},
): SurveyDef {
  const { questions = [], ...rest } = overrides
  return {
    id: 's1',
    title: '설문',
    description: '',
    status: 'open',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections: [{ id: 'sec1', questions }],
    ...rest,
  }
}

const singleQ = {
  id: 'q1',
  type: 'single' as const,
  title: '단일',
  description: '',
  required: true,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  options: [
    { id: 'o1', label: 'A', isOther: false },
    { id: 'o2', label: 'B', isOther: false },
  ],
  rules: [],
}

const multiQ = {
  id: 'q2',
  type: 'multi' as const,
  title: '다중',
  description: '',
  required: true,
  minSelect: 1,
  maxSelect: 2,
  allowOther: true,
  options: [
    { id: 'o3', label: 'C', isOther: false },
    { id: 'o4', label: 'D', isOther: false },
    { id: 'o5', label: '기타', isOther: true },
  ],
  rules: [],
}

const rankingQ = {
  id: 'q3',
  type: 'ranking' as const,
  title: '랭킹',
  description: '',
  required: true,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  options: [
    { id: 'o6', label: 'E', isOther: false },
    { id: 'o7', label: 'F', isOther: false },
    { id: 'o8', label: 'G', isOther: false },
  ],
  rules: [],
}

const textQ = {
  id: 'q4',
  type: 'text' as const,
  title: '주관식',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  options: [],
  rules: [],
}

const otherNotAllowedQ = {
  ...multiQ,
  id: 'q5',
  title: '기타 미허용',
  allowOther: false,
  minSelect: null,
  maxSelect: null,
  options: [
    { id: 'o9', label: 'E', isOther: false },
    { id: 'o10', label: '기타', isOther: true },
  ],
}

const base = { name: '홍길동', studentId: '20250001', browserKey: 'browser-key-1' }

describe('설문 상태', () => {
  it('열리지 않은 설문에는 제출할 수 없다', () => {
    const result = validateSubmission(survey({ status: 'draft', questions: [singleQ] }), {
      ...base,
      answers: [{ questionId: 'q1', type: 'single', optionId: 'o1' }],
    })
    expect(result).toEqual({ ok: false, errors: ['지금은 참여할 수 있는 설문이 아니에요.'] })
  })

  it('마감된 설문에는 제출할 수 없다', () => {
    const result = validateSubmission(survey({ status: 'closed', questions: [singleQ] }), {
      ...base,
      answers: [{ questionId: 'q1', type: 'single', optionId: 'o1' }],
    })
    expect(result.ok).toBe(false)
  })
})

describe('필수 문항', () => {
  it('필수 문항을 비우면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [singleQ] }), {
      ...base,
      answers: [],
    })
    expect(result).toEqual({ ok: false, errors: ['‘단일’ 문항은 꼭 답해야 해요.'] })
  })

  it('선택 문항은 비워도 통과한다', () => {
    const result = validateSubmission(survey({ questions: [textQ] }), {
      ...base,
      answers: [],
    })
    expect(result).toEqual({ ok: true })
  })

  it('필수 주관식에 공백만 넣으면 거부한다', () => {
    const required = { ...textQ, required: true }
    const result = validateSubmission(survey({ questions: [required] }), {
      ...base,
      answers: [{ questionId: 'q4', type: 'text', text: '   ' }],
    })
    expect(result.ok).toBe(false)
  })

  it('선택 문항이라도 답변 형식이 다르면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [textQ] }), {
      ...base,
      answers: [{ questionId: 'q4', type: 'ranking', order: [] }],
    })
    expect(result.ok).toBe(false)
  })
})

describe('단일 선택', () => {
  it('올바른 보기를 통과시킨다', () => {
    const result = validateSubmission(survey({ questions: [singleQ] }), {
      ...base,
      answers: [{ questionId: 'q1', type: 'single', optionId: 'o1' }],
    })
    expect(result).toEqual({ ok: true })
  })

  it('다른 문항의 보기 ID 를 거부한다', () => {
    const result = validateSubmission(survey({ questions: [singleQ] }), {
      ...base,
      answers: [{ questionId: 'q1', type: 'single', optionId: 'o3' }],
    })
    expect(result.ok).toBe(false)
  })

  it('문항 타입과 답변 타입이 다르면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [singleQ] }), {
      ...base,
      answers: [{ questionId: 'q1', type: 'text', text: '아무거나' }],
    })
    expect(result.ok).toBe(false)
  })

  it('설문에 없는 문항 ID 를 거부한다', () => {
    const result = validateSubmission(survey({ questions: [singleQ] }), {
      ...base,
      answers: [
        { questionId: 'q1', type: 'single', optionId: 'o1' },
        { questionId: 'unknown', type: 'single', optionId: 'o1' },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('한 문항에 두 번 답하면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [singleQ] }), {
      ...base,
      answers: [
        { questionId: 'q1', type: 'single', optionId: 'o1' },
        { questionId: 'q1', type: 'single', optionId: 'o2' },
      ],
    })
    expect(result.ok).toBe(false)
  })
})

describe('다중 선택', () => {
  it('허용 범위 안의 개수를 통과시킨다', () => {
    const result = validateSubmission(survey({ questions: [multiQ] }), {
      ...base,
      answers: [{ questionId: 'q2', type: 'multi', optionIds: ['o3', 'o4'] }],
    })
    expect(result).toEqual({ ok: true })
  })

  it('최대 개수를 넘으면 거부한다', () => {
    const three = { ...multiQ, maxSelect: 2 }
    const result = validateSubmission(survey({ questions: [three] }), {
      ...base,
      answers: [{ questionId: 'q2', type: 'multi', optionIds: ['o3', 'o4', 'o5'], otherText: '기타값' }],
    })
    expect(result.ok).toBe(false)
  })

  it('최소 개수에 못 미치면 거부한다', () => {
    const atLeastTwo = { ...multiQ, minSelect: 2 }
    const result = validateSubmission(survey({ questions: [atLeastTwo] }), {
      ...base,
      answers: [{ questionId: 'q2', type: 'multi', optionIds: ['o3'] }],
    })
    expect(result.ok).toBe(false)
  })

  it('같은 보기를 두 번 고르면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [multiQ] }), {
      ...base,
      answers: [{ questionId: 'q2', type: 'multi', optionIds: ['o3', 'o3'] }],
    })
    expect(result.ok).toBe(false)
  })
})

describe('기타 입력', () => {
  it('기타 보기를 고르고 내용을 적으면 통과한다', () => {
    const result = validateSubmission(survey({ questions: [multiQ] }), {
      ...base,
      answers: [{ questionId: 'q2', type: 'multi', optionIds: ['o5'], otherText: '제 의견' }],
    })
    expect(result).toEqual({ ok: true })
  })

  it('기타 보기를 고르고 내용을 비우면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [multiQ] }), {
      ...base,
      answers: [{ questionId: 'q2', type: 'multi', optionIds: ['o5'], otherText: '  ' }],
    })
    expect(result.ok).toBe(false)
  })

  it('기타 보기를 고르지 않았는데 내용이 오면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [multiQ] }), {
      ...base,
      answers: [{ questionId: 'q2', type: 'multi', optionIds: ['o3'], otherText: '몰래 넣은 값' }],
    })
    expect(result.ok).toBe(false)
  })

  it('기타를 허용하지 않는 문항에서 실제 기타 내용이 오면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [otherNotAllowedQ] }), {
      ...base,
      answers: [{ questionId: 'q5', type: 'multi', optionIds: ['o10'], otherText: '값' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('기타 내용을 적을 수 없어요')
  })

  it('기타를 허용하지 않아도 기타 보기를 내용 없이 고르는 것은 받아들인다', () => {
    const result = validateSubmission(survey({ questions: [otherNotAllowedQ] }), {
      ...base,
      answers: [{ questionId: 'q5', type: 'multi', optionIds: ['o10'] }],
    })
    expect(result).toEqual({ ok: true })
  })
})

describe('랭킹', () => {
  it('모든 보기를 한 번씩 담은 순서를 통과시킨다', () => {
    const result = validateSubmission(survey({ questions: [rankingQ] }), {
      ...base,
      answers: [{ questionId: 'q3', type: 'ranking', order: ['o8', 'o6', 'o7'] }],
    })
    expect(result).toEqual({ ok: true })
  })

  it('보기가 빠지면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [rankingQ] }), {
      ...base,
      answers: [{ questionId: 'q3', type: 'ranking', order: ['o6', 'o7'] }],
    })
    expect(result.ok).toBe(false)
  })

  it('같은 보기가 두 번 나오면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [rankingQ] }), {
      ...base,
      answers: [{ questionId: 'q3', type: 'ranking', order: ['o6', 'o6', 'o7'] }],
    })
    expect(result.ok).toBe(false)
  })

  it('설문에 없는 보기가 들어오면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [rankingQ] }), {
      ...base,
      answers: [{ questionId: 'q3', type: 'ranking', order: ['o6', 'o7', 'o1'] }],
    })
    expect(result.ok).toBe(false)
  })
})

describe('여러 오류', () => {
  it('오류를 모두 모아서 돌려준다', () => {
    const result = validateSubmission(survey({ questions: [singleQ, multiQ] }), {
      ...base,
      answers: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(2)
  })
})

describe('섹션', () => {
  it('섹션이 여럿이어도 모든 문항을 검사한다', () => {
    const required = { ...singleQ, id: 'q2', title: '두 번째', required: true }
    const result = validateSubmission(
      {
        id: 's1',
        title: '설문',
        description: '',
        status: 'open',
        resultsVisibility: 'after_close',
        closeAt: null,
        sections: [
          { id: 'sec1', questions: [singleQ] },
          { id: 'sec2', questions: [required] },
        ],
      },
      {
        name: '홍길동',
        studentId: '20250001',
        browserKey: 'browser-key-1',
        answers: [{ questionId: 'q1', type: 'single', optionId: 'o1' }],
      },
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors).toContain('‘두 번째’ 문항은 꼭 답해야 해요.')
  })
})

describe('조건 규칙', () => {
  const gateQ: QuestionDef = {
    id: 'gate',
    type: 'single',
    title: '수강합니까?',
    description: '',
    required: true,
    minSelect: null,
    maxSelect: null,
    allowOther: false,
    options: [
      { id: 'yes', label: '예', isOther: false },
      { id: 'no', label: '아니오', isOther: false },
    ],
    rules: [
      {
        match: 'all',
        action: 'show',
        targets: [{ kind: 'question', questionId: 'branch' }],
        conditions: [{ operator: 'is', optionId: 'yes' }],
      },
    ],
  }

  const branchQ: QuestionDef = {
    id: 'branch',
    type: 'single',
    title: '찬성합니까?',
    description: '',
    required: true,
    minSelect: null,
    maxSelect: null,
    allowOther: false,
    options: [
      { id: 'for', label: '찬성', isOther: false },
      { id: 'against', label: '반대', isOther: false },
    ],
    rules: [],
  }

  const base = { name: '홍길동', studentId: '1', browserKey: 'browser-key-1' }

  it('안 보이는 필수 문항은 답하지 않아도 통과한다', () => {
    const result = validateSubmission(survey({ questions: [gateQ, branchQ] }), {
      ...base,
      answers: [{ questionId: 'gate', type: 'single', optionId: 'no' }],
    })
    expect(result.ok).toBe(true)
  })

  it('보이는 필수 문항은 여전히 답해야 한다', () => {
    const result = validateSubmission(survey({ questions: [gateQ, branchQ] }), {
      ...base,
      answers: [{ questionId: 'gate', type: 'single', optionId: 'yes' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toContain('찬성합니까?')
  })

  it('안 보이는 문항에 답이 들어 있으면 거부한다', () => {
    const result = validateSubmission(survey({ questions: [gateQ, branchQ] }), {
      ...base,
      answers: [
        { questionId: 'gate', type: 'single', optionId: 'no' },
        { questionId: 'branch', type: 'single', optionId: 'for' },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toContain('보이지 않았어요')
  })
})
