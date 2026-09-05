import { describe, expect, it } from 'vitest'
import type { AnswerInput, QuestionDef, RuleDef, SurveyDef } from '../../src/shared/schema'
import { computeVisibility } from '../../src/shared/visibility'

function q(id: string, overrides: Partial<QuestionDef> = {}): QuestionDef {
  return {
    id,
    type: 'single',
    title: id,
    description: '',
    required: false,
    minSelect: null,
    maxSelect: null,
    allowOther: false,
    options: [
      { id: `${id}-yes`, label: '예', isOther: false },
      { id: `${id}-no`, label: '아니오', isOther: false },
    ],
    rules: [],
    ...overrides,
  }
}

function survey(sections: Array<{ id: string; questions: QuestionDef[] }>): SurveyDef {
  return {
    id: 's1',
    title: '설문',
    description: '',
    status: 'open',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections,
  }
}

function answers(...list: AnswerInput[]): Map<string, AnswerInput> {
  return new Map(list.map((a) => [a.questionId, a]))
}

function single(questionId: string, optionId: string): AnswerInput {
  return { questionId, type: 'single', optionId }
}

/** q1 이 소유한다. 조건은 언제나 소유 문항 자신의 답을 본다. */
const showQ2IfQ1Yes: RuleDef = {
  match: 'all',
  action: 'show',
  targets: [{ kind: 'question', questionId: 'q2' }],
  conditions: [{ operator: 'is', optionId: 'q1-yes' }],
}

describe('computeVisibility', () => {
  it('규칙이 없으면 모든 섹션과 문항이 보인다', () => {
    const s = survey([{ id: 'sec1', questions: [q('q1'), q('q2')] }])
    const v = computeVisibility(s, answers())
    expect(v.sections).toEqual(new Set(['sec1']))
    expect(v.questions).toEqual(new Set(['q1', 'q2']))
  })

  it('show 규칙의 대상은 조건이 맞기 전까지 숨는다', () => {
    const s = survey([{ id: 'sec1', questions: [q('q1', { rules: [showQ2IfQ1Yes] }), q('q2')] }])
    expect(computeVisibility(s, answers()).questions.has('q2')).toBe(false)
    expect(computeVisibility(s, answers(single('q1', 'q1-yes'))).questions.has('q2')).toBe(true)
    expect(computeVisibility(s, answers(single('q1', 'q1-no'))).questions.has('q2')).toBe(false)
  })

  it('hide 규칙의 대상은 조건이 맞을 때만 숨는다', () => {
    const rule: RuleDef = { ...showQ2IfQ1Yes, action: 'hide' }
    const s = survey([{ id: 'sec1', questions: [q('q1', { rules: [rule] }), q('q2')] }])
    expect(computeVisibility(s, answers()).questions.has('q2')).toBe(true)
    expect(computeVisibility(s, answers(single('q1', 'q1-yes'))).questions.has('q2')).toBe(false)
  })

  it('대상이 여럿이면 한 답이 그 전부를 함께 연다', () => {
    const rule: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [
        { kind: 'question', questionId: 'q2' },
        { kind: 'question', questionId: 'q3' },
      ],
      conditions: [{ operator: 'is', optionId: 'q1-no' }],
    }
    const s = survey([{ id: 'sec1', questions: [q('q1', { rules: [rule] }), q('q2'), q('q3')] }])

    const before = computeVisibility(s, answers())
    expect(before.questions.has('q2')).toBe(false)
    expect(before.questions.has('q3')).toBe(false)

    const after = computeVisibility(s, answers(single('q1', 'q1-no')))
    expect(after.questions.has('q2')).toBe(true)
    expect(after.questions.has('q3')).toBe(true)
  })

  it('한 문항의 두 규칙이 답에 따라 서로 다른 문항을 연다', () => {
    const owner = q('q1', {
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: 'q2' }],
          conditions: [{ operator: 'is', optionId: 'q1-yes' }],
        },
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: 'q3' }],
          conditions: [{ operator: 'is', optionId: 'q1-no' }],
        },
      ],
    })
    const s = survey([{ id: 'sec1', questions: [owner, q('q2'), q('q3')] }])

    const yes = computeVisibility(s, answers(single('q1', 'q1-yes')))
    expect(yes.questions.has('q2')).toBe(true)
    expect(yes.questions.has('q3')).toBe(false)

    const no = computeVisibility(s, answers(single('q1', 'q1-no')))
    expect(no.questions.has('q2')).toBe(false)
    expect(no.questions.has('q3')).toBe(true)
  })

  it('한 규칙이 문항과 화면을 함께 조종한다', () => {
    const rule: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [
        { kind: 'question', questionId: 'q2' },
        { kind: 'section', sectionId: 'sec2' },
      ],
      conditions: [{ operator: 'is', optionId: 'q1-yes' }],
    }
    const s = survey([
      { id: 'sec1', questions: [q('q1', { rules: [rule] }), q('q2')] },
      { id: 'sec2', questions: [q('q3')] },
    ])

    const before = computeVisibility(s, answers())
    expect(before.questions.has('q2')).toBe(false)
    expect(before.sections.has('sec2')).toBe(false)

    const after = computeVisibility(s, answers(single('q1', 'q1-yes')))
    expect(after.questions.has('q2')).toBe(true)
    expect(after.sections.has('sec2')).toBe(true)
    expect(after.questions.has('q3')).toBe(true)
  })

  it('match all 은 모든 조건을, any 는 하나만 요구한다', () => {
    // 조건은 모두 소유 문항의 답을 보므로, 둘을 가르려면 여러 개 고르는
    // 문항이라야 한다.
    const conditions = [
      { operator: 'includes' as const, optionId: 'a' },
      { operator: 'includes' as const, optionId: 'b' },
    ]
    const build = (match: 'all' | 'any') =>
      survey([
        {
          id: 'sec1',
          questions: [
            q('q1', {
              type: 'multi',
              options: [
                { id: 'a', label: 'A', isOther: false },
                { id: 'b', label: 'B', isOther: false },
              ],
              rules: [
                {
                  match,
                  action: 'show',
                  targets: [{ kind: 'question', questionId: 'q2' }],
                  conditions,
                },
              ],
            }),
            q('q2'),
          ],
        },
      ])

    const half: AnswerInput = { questionId: 'q1', type: 'multi', optionIds: ['a'] }
    expect(computeVisibility(build('all'), answers(half)).questions.has('q2')).toBe(false)
    expect(computeVisibility(build('any'), answers(half)).questions.has('q2')).toBe(true)
  })

  it('섹션을 대상으로 하면 그 안의 모든 문항이 함께 사라진다', () => {
    const rule: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [{ kind: 'section', sectionId: 'sec2' }],
      conditions: [{ operator: 'is', optionId: 'q1-yes' }],
    }
    const s = survey([
      { id: 'sec1', questions: [q('q1', { rules: [rule] })] },
      { id: 'sec2', questions: [q('q2'), q('q3')] },
    ])

    const hidden = computeVisibility(s, answers())
    expect(hidden.sections.has('sec2')).toBe(false)
    expect(hidden.questions.has('q2')).toBe(false)
    expect(hidden.questions.has('q3')).toBe(false)

    const shown = computeVisibility(s, answers(single('q1', 'q1-yes')))
    expect(shown.sections.has('sec2')).toBe(true)
    expect(shown.questions.has('q2')).toBe(true)
  })

  it('숨은 섹션 안의 문항은 문항 규칙이 보이라 해도 보이지 않는다', () => {
    const hideSection: RuleDef = {
      match: 'all',
      action: 'hide',
      targets: [{ kind: 'section', sectionId: 'sec2' }],
      conditions: [{ operator: 'is', optionId: 'q1-yes' }],
    }
    const showQ3: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [{ kind: 'question', questionId: 'q3' }],
      conditions: [{ operator: 'answered', optionId: null }],
    }
    const s = survey([
      { id: 'sec1', questions: [q('q1', { rules: [hideSection] }), q('q2', { rules: [showQ3] })] },
      { id: 'sec2', questions: [q('q3')] },
    ])

    const v = computeVisibility(
      s,
      answers(single('q1', 'q1-yes'), single('q2', 'q2-yes')),
    )
    expect(v.questions.has('q3')).toBe(false)
  })

  it('숨은 문항이 소유한 규칙은 부정 연산자여도 발동하지 않는다', () => {
    const showQ2: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [{ kind: 'question', questionId: 'q2' }],
      conditions: [{ operator: 'is', optionId: 'q1-yes' }],
    }
    // q2 는 "내게 답하지 않았다면 q3 를 보임"이라고 말한다. 그런데 q2 자체가
    // 숨어 있다 — 고르지도 못한 답이 q3 를 열어서는 안 된다(스펙 §3.5).
    const showQ3: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [{ kind: 'question', questionId: 'q3' }],
      conditions: [{ operator: 'not_answered', optionId: null }],
    }
    const s = survey([
      {
        id: 'sec1',
        questions: [q('q1', { rules: [showQ2] }), q('q2', { rules: [showQ3] }), q('q3')],
      },
    ])

    const v = computeVisibility(s, answers())
    expect(v.questions.has('q2')).toBe(false)
    expect(v.questions.has('q3')).toBe(false)
  })

  it('숨은 문항이 소유한 규칙은 발동하지 않는다', () => {
    const showQ2: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [{ kind: 'question', questionId: 'q2' }],
      conditions: [{ operator: 'is', optionId: 'q1-yes' }],
    }
    const q2Rule: RuleDef = {
      match: 'all',
      action: 'hide',
      targets: [{ kind: 'question', questionId: 'q3' }],
      conditions: [{ operator: 'not_answered', optionId: null }],
    }
    const s = survey([
      {
        id: 'sec1',
        questions: [q('q1', { rules: [showQ2] }), q('q2', { rules: [q2Rule] }), q('q3')],
      },
    ])

    // q1 = 아니오 → q2 는 숨는다. 숨은 q2 의 규칙이 q3 를 숨겨서는 안 된다.
    const v = computeVisibility(s, answers(single('q1', 'q1-no')))
    expect(v.questions.has('q2')).toBe(false)
    expect(v.questions.has('q3')).toBe(true)
  })

  it('multi 소유 문항에는 includes·not_includes 가 쓰인다', () => {
    const multiQ = q('q1', {
      type: 'multi',
      options: [
        { id: 'a', label: 'A', isOther: false },
        { id: 'b', label: 'B', isOther: false },
      ],
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: 'q2' }],
          conditions: [{ operator: 'includes', optionId: 'a' }],
        },
      ],
    })
    const s = survey([{ id: 'sec1', questions: [multiQ, q('q2')] }])
    const picked: AnswerInput = { questionId: 'q1', type: 'multi', optionIds: ['a', 'b'] }
    const notPicked: AnswerInput = { questionId: 'q1', type: 'multi', optionIds: ['b'] }

    expect(computeVisibility(s, answers(picked)).questions.has('q2')).toBe(true)
    expect(computeVisibility(s, answers(notPicked)).questions.has('q2')).toBe(false)
  })

  it('is_not 은 답이 있을 때만 참이다', () => {
    const rule: RuleDef = {
      match: 'all',
      action: 'show',
      targets: [{ kind: 'question', questionId: 'q2' }],
      conditions: [{ operator: 'is_not', optionId: 'q1-yes' }],
    }
    const s = survey([{ id: 'sec1', questions: [q('q1', { rules: [rule] }), q('q2')] }])

    expect(computeVisibility(s, answers()).questions.has('q2')).toBe(false)
    expect(computeVisibility(s, answers(single('q1', 'q1-no'))).questions.has('q2')).toBe(true)
  })
})
