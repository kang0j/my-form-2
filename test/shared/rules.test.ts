import { describe, expect, it } from 'vitest'
import { checkRules, surveyToDraft } from '../../src/shared/rules'
import type { QuestionDef, SurveyDef, SurveyDraftInput } from '../../src/shared/schema'

type QuestionDraft = SurveyDraftInput['sections'][number]['questions'][number]

function q(title: string, overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    type: 'single',
    title,
    description: '',
    required: false,
    minSelect: null,
    maxSelect: null,
    allowOther: false,
    options: [
      { label: '예', isOther: false },
      { label: '아니오', isOther: false },
    ],
    rules: [],
    ...overrides,
  }
}

function draft(sections: QuestionDraft[][]): SurveyDraftInput {
  return {
    title: '설문',
    description: '',
    resultsVisibility: 'after_close',
    sections: sections.map((questions) => ({ questions })),
  }
}

/** 0번 문항이 소유한다 — 조건은 언제나 소유 문항 자신의 답을 본다. */
const showSecond = {
  match: 'all' as const,
  action: 'show' as const,
  targets: [{ kind: 'question' as const, questionIndex: 1 }],
  conditions: [{ operator: 'is' as const, optionIndex: 0 }],
}

describe('checkRules', () => {
  it('올바른 규칙은 통과한다', () => {
    expect(checkRules(draft([[q('1', { rules: [showSecond] }), q('2')]]))).toEqual([])
  })

  it('대상이 소유 문항 자신이거나 그 앞이면 거부한다', () => {
    const bad = { ...showSecond, targets: [{ kind: 'question' as const, questionIndex: 0 }] }
    expect(checkRules(draft([[q('1', { rules: [bad] }), q('2')]]))).not.toEqual([])
  })

  it('없는 문항을 대상으로 하면 거부한다', () => {
    const bad = { ...showSecond, targets: [{ kind: 'question' as const, questionIndex: 9 }] }
    expect(checkRules(draft([[q('1', { rules: [bad] }), q('2')]]))).not.toEqual([])
  })

  it('대상을 여러 개 지목한 규칙도 통과한다', () => {
    const many = {
      ...showSecond,
      targets: [
        { kind: 'question' as const, questionIndex: 1 },
        { kind: 'question' as const, questionIndex: 2 },
      ],
    }
    expect(checkRules(draft([[q('1', { rules: [many] }), q('2'), q('3')]]))).toEqual([])
  })

  it('한 규칙이 같은 대상을 두 번 적으면 거부한다', () => {
    const twice = {
      ...showSecond,
      targets: [
        { kind: 'question' as const, questionIndex: 1 },
        { kind: 'question' as const, questionIndex: 1 },
      ],
    }
    expect(checkRules(draft([[q('1', { rules: [twice] }), q('2')]]))).not.toEqual([])
  })

  it('대상이 하나도 없으면 거부한다', () => {
    const bad = { ...showSecond, targets: [] }
    expect(checkRules(draft([[q('1', { rules: [bad] }), q('2')]]))).not.toEqual([])
  })

  it('한 문항이 서로 다른 대상을 여는 규칙 둘을 갖는다', () => {
    // 「예면 2번, 아니오면 3번」 — 한 규칙의 AND/OR 로는 적을 수 없는 모양이다.
    const both = q('1', {
      rules: [
        {
          match: 'all' as const,
          action: 'show' as const,
          targets: [{ kind: 'question' as const, questionIndex: 1 }],
          conditions: [{ operator: 'is' as const, optionIndex: 0 }],
        },
        {
          match: 'all' as const,
          action: 'show' as const,
          targets: [{ kind: 'question' as const, questionIndex: 2 }],
          conditions: [{ operator: 'is' as const, optionIndex: 1 }],
        },
      ],
    })
    expect(checkRules(draft([[both, q('2'), q('3')]]))).toEqual([])
  })

  it('한 문항의 두 규칙이 같은 대상을 지목하면 거부한다', () => {
    const clash = q('1', {
      rules: [
        {
          match: 'all' as const,
          action: 'show' as const,
          targets: [{ kind: 'question' as const, questionIndex: 1 }],
          conditions: [{ operator: 'is' as const, optionIndex: 0 }],
        },
        {
          match: 'all' as const,
          action: 'hide' as const,
          targets: [{ kind: 'question' as const, questionIndex: 1 }],
          conditions: [{ operator: 'is' as const, optionIndex: 1 }],
        },
      ],
    })
    expect(checkRules(draft([[clash, q('2')]]))).not.toEqual([])
  })

  it('한 대상을 두 규칙이 지목하면 거부한다', () => {
    const first = q('1', { rules: [showSecond] })
    const second = q('2', {
      rules: [
        {
          ...showSecond,
          targets: [{ kind: 'question' as const, questionIndex: 1 }],
          conditions: [{ operator: 'is' as const, optionIndex: 1 }],
        },
      ],
    })
    expect(checkRules(draft([[first, second, q('3')]]))).not.toEqual([])
  })

  it('소유 문항이 single 인데 includes 연산자를 쓰면 거부한다', () => {
    const bad = {
      ...showSecond,
      conditions: [{ operator: 'includes' as const, optionIndex: 0 }],
    }
    expect(checkRules(draft([[q('1', { rules: [bad] }), q('2')]]))).not.toEqual([])
  })

  it('answered 조건에 보기 인덱스가 있으면 거부한다', () => {
    const bad = {
      ...showSecond,
      conditions: [{ operator: 'answered' as const, optionIndex: 0 }],
    }
    expect(checkRules(draft([[q('1', { rules: [bad] }), q('2')]]))).not.toEqual([])
  })

  it('없는 보기를 가리키면 거부한다', () => {
    const bad = {
      ...showSecond,
      conditions: [{ operator: 'is' as const, optionIndex: 5 }],
    }
    expect(checkRules(draft([[q('1', { rules: [bad] }), q('2')]]))).not.toEqual([])
  })

  it('섹션 대상은 소유 문항보다 뒤 화면이어야 한다', () => {
    const sameSection = {
      match: 'all' as const,
      action: 'show' as const,
      targets: [{ kind: 'section' as const, sectionIndex: 0 }],
      conditions: [{ operator: 'is' as const, optionIndex: 0 }],
    }
    expect(checkRules(draft([[q('1', { rules: [sameSection] })], [q('2')]]))).not.toEqual([])

    const laterSection = { ...sameSection, targets: [{ kind: 'section' as const, sectionIndex: 1 }] }
    expect(checkRules(draft([[q('1', { rules: [laterSection] })], [q('2')]]))).toEqual([])
  })

  it('조건이 없으면 거부한다', () => {
    const bad = { ...showSecond, conditions: [] }
    expect(checkRules(draft([[q('1', { rules: [bad] }), q('2')]]))).not.toEqual([])
  })
})

describe('surveyToDraft — 저장된 설문을 편집용 초안으로', () => {
  function question(id: string, overrides: Partial<QuestionDef> = {}): QuestionDef {
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
        { id: `${id}-o1`, label: '예', isOther: false },
        { id: `${id}-o2`, label: '아니오', isOther: false },
      ],
      rules: [],
      ...overrides,
    }
  }

  function survey(sections: SurveyDef['sections']): SurveyDef {
    return {
      id: 's1',
      title: '설문',
      description: '',
      status: 'draft',
      resultsVisibility: 'after_close',
      closeAt: null,
      sections,
    }
  }

  it('문항 대상 규칙을 평면 인덱스로 옮긴다', () => {
    const owner = question('q1', {
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: 'q3' }],
          conditions: [{ operator: 'is', optionId: 'q1-o2' }],
        },
      ],
    })
    const draft = surveyToDraft(
      survey([
        { id: 'sec1', questions: [owner, question('q2')] },
        { id: 'sec2', questions: [question('q3')] },
      ]),
    )

    expect(draft.sections[0].questions[0].rules![0]).toEqual({
      match: 'all',
      action: 'show',
      targets: [{ kind: 'question', questionIndex: 2 }],
      conditions: [{ operator: 'is', optionIndex: 1 }],
    })
    // 그대로 저장할 수 있어야 한다 — 규칙을 잃지 않았다는 것의 진짜 시험이다.
    expect(checkRules(draft)).toEqual([])
  })

  it('화면 대상 규칙은 섹션 인덱스로 옮긴다', () => {
    const owner = question('q1', {
      rules: [
        {
          match: 'any',
          action: 'hide',
          targets: [{ kind: 'section', sectionId: 'sec2' }],
          conditions: [{ operator: 'answered', optionId: null }],
        },
      ],
    })
    const draft = surveyToDraft(
      survey([
        { id: 'sec1', questions: [owner] },
        { id: 'sec2', questions: [question('q2')] },
      ]),
    )

    expect(draft.sections[0].questions[0].rules![0]).toEqual({
      match: 'any',
      action: 'hide',
      targets: [{ kind: 'section', sectionIndex: 1 }],
      conditions: [{ operator: 'answered', optionIndex: null }],
    })
    expect(checkRules(draft)).toEqual([])
  })

  it('가리키던 것이 없는 규칙은 통째로 버린다', () => {
    const owner = question('q1', {
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: '없는문항' }],
          conditions: [{ operator: 'is', optionId: 'q1-o1' }],
        },
      ],
    })
    const draft = surveyToDraft(survey([{ id: 'sec1', questions: [owner, question('q2')] }]))

    expect(draft.sections[0].questions[0].rules ?? []).toEqual([])
  })

  it('대상이 여럿이면 살아남은 것만 옮기고, 하나도 없으면 규칙째 버린다', () => {
    const owner = question('q1', {
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [
            { kind: 'question', questionId: 'q2' },
            { kind: 'question', questionId: '없는문항' },
            { kind: 'section', sectionId: 'sec2' },
          ],
          conditions: [{ operator: 'is', optionId: 'q1-o1' }],
        },
      ],
    })
    const draft = surveyToDraft(
      survey([
        { id: 'sec1', questions: [owner, question('q2')] },
        { id: 'sec2', questions: [question('q3')] },
      ]),
    )

    expect(draft.sections[0].questions[0].rules![0].targets).toEqual([
      { kind: 'question', questionIndex: 1 },
      { kind: 'section', sectionIndex: 1 },
    ])
    expect(checkRules(draft)).toEqual([])
  })

  it('보기를 찾지 못한 조건만 남은 규칙은 버린다', () => {
    const owner = question('q1', {
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: 'q2' }],
          conditions: [{ operator: 'is', optionId: '없는보기' }],
        },
      ],
    })
    const draft = surveyToDraft(survey([{ id: 'sec1', questions: [owner, question('q2')] }]))

    expect(draft.sections[0].questions[0].rules ?? []).toEqual([])
  })

  it('규칙이 없는 문항은 rule 이 null 이고 나머지 값은 그대로다', () => {
    const draft = surveyToDraft(
      survey([{ id: 'sec1', questions: [question('q1', { required: true, allowOther: true })] }]),
    )

    expect(draft.sections[0].questions[0]).toEqual({
      type: 'single',
      title: 'q1',
      description: '',
      required: true,
      minSelect: null,
      maxSelect: null,
      allowOther: true,
      options: [
        { label: '예', isOther: false },
        { label: '아니오', isOther: false },
      ],
      rules: [],
    })
  })
})
