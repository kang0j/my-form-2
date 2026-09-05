import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Flat } from '../../shared/rules'
import {
  OPERATORS_BY_TYPE,
  VALUELESS_OPERATORS as VALUELESS,
  checkRules,
  flattenDraft,
} from '../../shared/rules'
import type {
  ConditionDraft,
  ConditionOperator,
  QuestionType,
  RuleDraft,
  RuleTargetDraft,
  SurveyDraftInput,
} from '../../shared/schema'

type Props = {
  draft: SurveyDraftInput
  onChange: (draft: SurveyDraftInput) => void
  /** 설문이 draft 상태를 벗어나면 문항은 더 이상 고칠 수 없다 — 결과
   * 공개 설정만 예외다. 시도해 보고서야 막히지 않도록 필드 자체를 잠근다. */
  locked?: boolean
}

type QuestionDraft = SurveyDraftInput['sections'][number]['questions'][number]

const TYPE_LABELS: Record<QuestionType, string> = {
  single: '객관식 (단일)',
  multi: '객관식 (복수)',
  text: '주관식',
  ranking: '랭킹',
}

/**
 * 연산자를 관리자에게 보이는 말로. 표 자체는 rules.ts 가 권위다.
 *
 * 「이 문항에서 [예] [고르면]」으로 한 문장이 되게 적는다 — 예전의 「~이다」
 * 「답했음」은 조건식을 그대로 옮긴 말이라, 관리자가 읽으면서 한 번 더
 * 번역해야 했다. 값이 있는 연산자는 보기 드롭다운 뒤에 선다(§JSX 순서).
 */
const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: '고르면',
  is_not: '고르지 않으면',
  includes: '고르면',
  not_includes: '고르지 않으면',
  answered: '답하면',
  not_answered: '답하지 않으면',
}

/**
 * 참조 문항이 허락하는 연산자. 참조가 사라진 자리(문항이 지워진 직후 등)에는
 * 어느 타입에나 있는 「답했음」만 남긴다 — 빈 드롭다운을 내놓지 않기 위해서다.
 */
function allowedOperators(referenced: QuestionDraft | undefined): ConditionOperator[] {
  return referenced ? OPERATORS_BY_TYPE[referenced.type] : ['answered']
}

/** 조건 한 줄의 기본값. 소유 문항의 첫 보기를 가리킨다. */
function defaultCondition(owner: QuestionDraft | undefined): ConditionDraft {
  const operator = allowedOperators(owner)[0]
  return {
    operator,
    optionIndex: VALUELESS.includes(operator) ? null : 0,
  }
}

/**
 * 「조건 추가」를 누를 때 만들어지는 규칙.
 *
 * 대상은 아직 아무도 찜하지 않은 가장 가까운 뒤 문항이다 — 조건을 만드는
 * 사람이 열에 아홉 원하는 것이 그것이고, 아무것도 고르지 않은 빈 목록을
 * 마주하게 하는 것보다 낫다. 이미 다른 규칙이 지목한 문항을 집으면 만들자마자
 * 저장이 막히는 규칙이 되므로 건너뛴다. 남은 자리가 없으면 규칙을 만들지
 * 않는다.
 */
function newRule(flat: Flat[], flatIndex: number): RuleDraft | null {
  const taken = new Set<number>()
  for (const f of flat) {
    for (const rule of f.question.rules ?? []) {
      for (const target of rule.targets) {
        if (target.kind === 'question') taken.add(target.questionIndex)
      }
    }
  }

  const next = flat.find((f) => f.index > flatIndex && !taken.has(f.index))
  if (!next) return null
  return {
    match: 'all',
    action: 'show',
    targets: [{ kind: 'question', questionIndex: next.index }],
    conditions: [defaultCondition(flat[flatIndex]?.question)],
  }
}

/** 대상 하나를 체크박스 값으로. 파싱은 parseTargetValue 가 되돌린다. */
function targetValue(target: RuleTargetDraft): string {
  return target.kind === 'question' ? `q:${target.questionIndex}` : `s:${target.sectionIndex}`
}

function parseTargetValue(value: string): RuleTargetDraft {
  const [kind, raw] = value.split(':')
  const index = Number(raw)
  return kind === 'q'
    ? { kind: 'question', questionIndex: index }
    : { kind: 'section', sectionIndex: index }
}

/**
 * 대상 목록에 오를 것들.
 *
 * 빠지는 것: 자기 자신과 그 앞의 문항(조건이 나오기 전에 이미 지나갔다),
 * 다른 규칙이 이미 지목한 것(대상당 지목 한 번), 그리고 화면 대상의 경우
 * 소유자와 같거나 앞선 화면. 지금 이 규칙이 고른 대상은 무슨 일이 있어도
 * 남긴다 — 문항을 옮겨 순서가 어긋난 대상이 목록에서 사라지면 관리자는
 * 저장을 막는 그 대상을 끌 방법이 없다.
 */
function targetChoices(
  draft: SurveyDraftInput,
  flat: Flat[],
  flatIndex: number,
  rule: RuleDraft,
): Array<{ value: string; label: string }> {
  const takenQuestions = new Set<number>()
  const takenSections = new Set<number>()
  for (const f of flat) {
    // 같은 문항의 다른 규칙도 남이다 — 「예면 1번」과 「아니오면 1번」은
    // 한 대상을 둘이 조종하는 것이라 저장이 거부된다.
    for (const other of f.question.rules ?? []) {
      if (other === rule) continue
      for (const target of other.targets) {
        if (target.kind === 'question') takenQuestions.add(target.questionIndex)
        else takenSections.add(target.sectionIndex)
      }
    }
  }

  const mine = new Set(rule.targets.map(targetValue))
  const owner = flat[flatIndex]
  const choices: Array<{ value: string; label: string }> = []

  for (const f of flat) {
    const value = `q:${f.index}`
    if (!mine.has(value) && (f.index <= flatIndex || takenQuestions.has(f.index))) continue
    choices.push({ value, label: f.label })
  }

  draft.sections.forEach((_, sectionIndex) => {
    const value = `s:${sectionIndex}`
    // 화면 자체를 조종하는 규칙은 앞선 화면의 답으로만 정해질 수 있다.
    const tooEarly = !owner || sectionIndex <= owner.sectionIndex
    if (!mine.has(value) && (tooEarly || takenSections.has(sectionIndex))) return
    choices.push({ value, label: `${sectionIndex + 1}번째 화면 전체` })
  })

  return choices
}

/**
 * 개수 제한 입력칸(최소·최대 선택)의 값 읽기.
 *
 * 빈 칸은 「제한 없음」(null)이다. 숫자가 아닌 글자는 버린다 — Number('가')
 * 는 NaN 이고, 그 NaN 이 그대로 상태에 들어가면 `minSelect ?? ''` 가 NaN 을
 * 그대로 통과시켜 입력칸에 「NaN」이 박힌 채 지워지지도 않는다.
 */
function toCount(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, '')
  return digits === '' ? null : Number(digits)
}

function newQuestion(): QuestionDraft {
  return {
    type: 'single',
    title: '',
    description: '',
    required: false,
    minSelect: null,
    maxSelect: null,
    allowOther: false,
    options: [{ label: '', isOther: false }],
  }
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * 묶음 안에서 한 칸 옮기되, 끝에 닿으면 이웃 묶음으로 건너간다.
 *
 * 섹션 경계를 특별 취급하지 않는 것이 요점이다: 관리자가 보는 것은 위에서
 * 아래로 흐르는 문항 하나뿐이고, 그 흐름 중간에 화면이 끊기는 자리가 있을
 * 뿐이다. 「위로」를 계속 누르면 문항은 자연히 앞 섹션으로 넘어간다.
 *
 * 이 함수가 문항 목록과 보기 id 그림자 배열 양쪽에 그대로 쓰이는 것도
 * 일부러다 — 같은 연산을 두 번 손으로 적으면 언젠가 한쪽만 고친다.
 * 옮길 곳이 없으면(맨 앞에서 위로) null 을 돌려준다.
 */
function moveNested<T>(groups: T[][], groupIndex: number, index: number, delta: number): T[][] | null {
  const next = groups.map((group) => [...group])
  const from = next[groupIndex]

  const target = index + delta
  if (target >= 0 && target < from.length) {
    const [moved] = from.splice(index, 1)
    from.splice(target, 0, moved)
    return next
  }

  const neighbor = groupIndex + delta
  if (neighbor < 0 || neighbor >= next.length) return null

  const [moved] = from.splice(index, 1)
  if (delta < 0) next[neighbor].push(moved)
  else next[neighbor].unshift(moved)
  return next
}

// 보기 행의 React key 전용 로컬 id. SurveyDraftInput 의 보기(option)에는 id 가
// 없다 — 서버로 나가는 형태를 그대로 유지하려고 공유 스키마(src/shared)에는
// 손대지 않는다. 그래서 화면에서만 쓰는 안정적인 id 를 별도로 들고 다닌다.
// 배열 인덱스를 key 로 쓰면(§I3) 재정렬 때 React 가 "같은 자리의 값이
// 바뀐 것"으로 착각해 포커스가 옮겨진 보기가 아니라 그 자리에 남는다 —
// 「보기 2 위로 이동」을 두 번 누르면 B 가 위로, 다시 A 가 아래로 왔다 갔다
// 하는 핑퐁이 그래서 생긴다. 랭킹 문항(RankingQuestion)의 key={optionId}
// 와 같은 처방이다.
let nextLocalId = 0
function makeLocalId(prefix: string): string {
  nextLocalId += 1
  return `${prefix}-${nextLocalId}`
}

/**
 * 문항이 옮겨지거나 지워진 뒤 규칙의 인덱스 참조를 새 자리로 옮긴다.
 *
 * `questionMap` 은 옛 평면 인덱스 → 새 평면 인덱스(사라졌으면 null),
 * `sectionMap` 은 옛 섹션 인덱스 → 새 섹션 인덱스다.
 *
 * 사라진 대상은 그 대상만 지우고, 대상이 하나도 남지 않으면 규칙째 지운다
 * — 반쪽짜리 규칙을 남기면 저장이 거부되는데 관리자는 자기가 지운 문항과
 * 그 거부를 잇지 못한다.
 */
function remapRules(
  sections: SurveyDraftInput['sections'],
  questionMap: Array<number | null>,
  sectionMap: Array<number | null>,
): SurveyDraftInput['sections'] {
  return sections.map((section) => ({
    ...section,
    questions: section.questions.map((question) => {
      const rules = (question.rules ?? []).flatMap((rule): RuleDraft[] => {
        const targets = rule.targets.flatMap((target): RuleTargetDraft[] => {
          if (target.kind === 'question') {
            const next = questionMap[target.questionIndex]
            return next === null || next === undefined
              ? []
              : [{ kind: 'question', questionIndex: next }]
          }
          const next = sectionMap[target.sectionIndex]
          return next === null || next === undefined ? [] : [{ kind: 'section', sectionIndex: next }]
        })
        // 대상이 하나도 남지 않은 규칙은 아무것도 조종하지 않는다.
        if (targets.length === 0) return []

        // 조건은 소유 문항의 답만 보므로 옮길 참조가 없다 — 소유 문항이
        // 사라지면 규칙도 그 문항과 함께 사라진다.
        return [{ ...rule, targets }]
      })

      return { ...question, rules }
    }),
  }))
}

/** 지금 초안의 문항들을 평면 순서대로 식별하기 위한 임시 표식. */
function flatKeys(sections: SurveyDraftInput['sections']): object[] {
  return sections.flatMap((section) => section.questions)
}

export function SurveyEditor({ draft, onChange, locked = false }: Props) {
  // draft.sections[].questions[].options 와 나란히 가는 로컬 id 그림자 배열.
  // 바깥 차원이 섹션, 그 안이 문항, 그 안이 보기다 — draft 와 같은 모양을
  // 유지해야 인덱스 접근이 어긋나지 않는다. 이 컴포넌트 안의 함수들만
  // 구조를 건드리므로, 그 함수들이 추가·삭제·이동 때마다 함께 갱신한다.
  // 내용 수정(patchOption)은 id 를 바꾸지 않는다 — 그래야 라벨 입력 중 매
  // 키 입력마다 key 가 바뀌어 포커스가 날아가는 일이 없다.
  const optionIdsRef = useRef<string[][][] | null>(null)
  if (!optionIdsRef.current) {
    optionIdsRef.current = draft.sections.map((section) =>
      section.questions.map((q) => q.options.map(() => makeLocalId('opt'))),
    )
  }

  // 문항 <fieldset> 의 React key. 보기·섹션과 같은 처방이다 — 자리(index)를
  // key 로 쓰면 문항을 옮기거나 지웠을 때 React 가 "같은 자리의 값이 바뀐
  // 것"으로 보아 DOM 을 재사용하고, 그러면 입력 포커스가 옮겨진 문항이
  // 아니라 그 자리에 남는다(§I3).
  const questionIdsRef = useRef<string[][] | null>(null)
  if (!questionIdsRef.current) {
    questionIdsRef.current = draft.sections.map((section) =>
      section.questions.map(() => makeLocalId('q')),
    )
  }

  // 섹션 <fieldset> 의 React key. 섹션에도 id 가 없어서(§SectionDef — 서버가
  // 새로 발급한다) 보기와 같은 처방을 쓴다. 섹션을 위로 옮겼을 때 그 안의
  // 입력 포커스가 따라가려면 key 가 자리가 아니라 섹션을 가리켜야 한다.
  const sectionIdsRef = useRef<string[] | null>(null)
  if (!sectionIdsRef.current) {
    sectionIdsRef.current = draft.sections.map(() => makeLocalId('sec'))
  }

  // 위/아래 버튼을 누른 뒤 포커스를 따라가기 위한 예약. 키만 안정시켜도
  // React 는 같은 DOM 노드를 새 자리로 옮겨 재사용하므로 포커스는 대체로
  // 저절로 따라오지만, 옮긴 자리가 배열의 끝이면(맨 위/맨 아래) 그 방향
  // 버튼이 disabled 가 되어 브라우저가 포커스를 강제로 <body> 로 떨어뜨린다
  // (§I3). 그 경우에만 반대 방향 버튼으로 명시적으로 옮긴다.
  const pendingFocusRef = useRef<{ optionId: string; dir: 'up' | 'down' } | null>(null)
  const optionButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    const primary = optionButtonRefs.current.get(`${pending.optionId}-${pending.dir}`)
    if (primary && !primary.disabled) {
      primary.focus()
      return
    }
    const fallbackDir = pending.dir === 'up' ? 'down' : 'up'
    optionButtonRefs.current.get(`${pending.optionId}-${fallbackDir}`)?.focus()
  })

  /**
   * 구조를 바꾸는 버튼을 누른 뒤에도 화면이 제자리에 있게 한다.
   *
   * 문항·보기·조건을 하나 붙이면 그 자리 위아래의 높이가 달라지고, 브라우저는
   * 그때 스크롤을 제 나름대로 맞춘다 — 누른 사람 눈에는 화면이 저 혼자
   * 뛰어간 것으로 보인다. 편집기에서 자리를 옮기는 것은 「위로」·「아래로」
   * 뿐이어야 한다. 값은 누르기 직전의 스크롤 위치이고, 다음 그리기가 끝난
   * 직후(useLayoutEffect — 화면에 칠해지기 전이다) 그 자리로 되돌린다.
   */
  const keepScrollRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const top = keepScrollRef.current
    if (top === null) return
    keepScrollRef.current = null
    window.scrollTo?.({ top })
  })

  function keepScroll() {
    keepScrollRef.current = window.scrollY
  }

  function setSections(sections: SurveyDraftInput['sections']) {
    onChange({ ...draft, sections })
  }

  /**
   * 구조가 바뀐 새 섹션 배열을 받아, 옛 자리와 새 자리를 문항 객체의
   * 동일성으로 맞춰 규칙 참조를 옮긴 뒤 onChange 한다.
   *
   * 인덱스를 손으로 계산하지 않는 것이 요점이다 — moveNested 는 문항을
   * 섹션 사이로 넘기므로 평면 인덱스가 통째로 밀리고, 그 계산을 두 번째로
   * 적는 순간 어긋난다.
   *
   * 내용만 고치는 함수(patchQuestion·patchOption)는 이 길로 오지 않는다 —
   * 그쪽은 문항 객체를 새로 만들므로 동일성 비교가 모두 어긋난다.
   */
  function setSectionsRemapped(
    nextSections: SurveyDraftInput['sections'],
    sectionMap: Array<number | null>,
  ) {
    const before = flatKeys(draft.sections)
    const after = flatKeys(nextSections)
    const questionMap = before.map((question) => {
      const index = after.indexOf(question)
      return index === -1 ? null : index
    })
    setSections(remapRules(nextSections, questionMap, sectionMap))
  }

  /** 섹션 순서를 건드리지 않는 변경이 쓰는 항등 지도. */
  function sameSections(): Array<number | null> {
    return draft.sections.map((_, i) => i)
  }

  function patchSectionQuestions(sIndex: number, questions: QuestionDraft[]) {
    setSections(draft.sections.map((s, i) => (i === sIndex ? { ...s, questions } : s)))
  }

  function patchQuestion(sIndex: number, qIndex: number, patch: Partial<QuestionDraft>) {
    patchSectionQuestions(
      sIndex,
      draft.sections[sIndex].questions.map((q, i) => (i === qIndex ? { ...q, ...patch } : q)),
    )
  }

  function patchRule(sIndex: number, qIndex: number, rIndex: number, patch: Partial<RuleDraft>) {
    const rules = draft.sections[sIndex].questions[qIndex].rules ?? []
    if (!rules[rIndex]) return
    patchQuestion(sIndex, qIndex, {
      rules: rules.map((rule, i) => (i === rIndex ? { ...rule, ...patch } : rule)),
    })
  }

  function patchCondition(
    sIndex: number,
    qIndex: number,
    rIndex: number,
    cIndex: number,
    patch: Partial<ConditionDraft>,
  ) {
    const rule = (draft.sections[sIndex].questions[qIndex].rules ?? [])[rIndex]
    if (!rule) return
    patchRule(sIndex, qIndex, rIndex, {
      conditions: rule.conditions.map((c, i) => (i === cIndex ? { ...c, ...patch } : c)),
    })
  }

  function changeConditionOperator(
    sIndex: number,
    qIndex: number,
    rIndex: number,
    cIndex: number,
    operator: ConditionOperator,
  ) {
    patchCondition(sIndex, qIndex, rIndex, cIndex, {
      operator,
      optionIndex: VALUELESS.includes(operator) ? null : 0,
    })
  }

  /** 규칙 하나를 새로 만든다. 「조건 추가」가 부른다. */
  function addRule(sIndex: number, qIndex: number, flatIndex: number) {
    keepScroll()
    const question = draft.sections[sIndex].questions[qIndex]
    const rules = question.rules ?? []
    if (rules.length >= 8) return
    const fresh = newRule(flattenDraft(draft), flatIndex)
    if (!fresh) return
    patchQuestion(sIndex, qIndex, { rules: [...rules, fresh] })
  }

  function removeRule(sIndex: number, qIndex: number, rIndex: number) {
    keepScroll()
    const rules = draft.sections[sIndex].questions[qIndex].rules ?? []
    patchQuestion(sIndex, qIndex, { rules: rules.filter((_, i) => i !== rIndex) })
  }

  function addCondition(sIndex: number, qIndex: number, rIndex: number) {
    keepScroll()
    const question = draft.sections[sIndex].questions[qIndex]
    const rule = (question.rules ?? [])[rIndex]
    if (!rule || rule.conditions.length >= 8) return
    patchRule(sIndex, qIndex, rIndex, {
      conditions: [...rule.conditions, defaultCondition(question)],
    })
  }

  function removeCondition(sIndex: number, qIndex: number, rIndex: number, cIndex: number) {
    keepScroll()
    const rule = (draft.sections[sIndex].questions[qIndex].rules ?? [])[rIndex]
    if (!rule) return
    const conditions = rule.conditions.filter((_, i) => i !== cIndex)
    // 조건 줄이 하나도 없는 규칙은 아무것도 뜻하지 않는다 — 규칙째 지운다.
    if (conditions.length === 0) {
      removeRule(sIndex, qIndex, rIndex)
      return
    }
    patchRule(sIndex, qIndex, rIndex, { conditions })
  }

  /**
   * 대상 하나를 켜고 끈다.
   *
   * 마지막 하나는 끄지 못한다 — 대상이 없는 규칙은 아무것도 뜻하지 않고,
   * 저장도 거부된다. 규칙을 없애려면 「조건 지우기」가 있다.
   */
  function toggleTarget(
    sIndex: number,
    qIndex: number,
    rIndex: number,
    value: string,
    checked: boolean,
  ) {
    const rule = (draft.sections[sIndex].questions[qIndex].rules ?? [])[rIndex]
    if (!rule) return
    if (checked) {
      if (rule.targets.some((t) => targetValue(t) === value)) return
      patchRule(sIndex, qIndex, rIndex, { targets: [...rule.targets, parseTargetValue(value)] })
      return
    }
    const targets = rule.targets.filter((t) => targetValue(t) !== value)
    if (targets.length === 0) return
    patchRule(sIndex, qIndex, rIndex, { targets })
  }

  function moveQuestion(sIndex: number, qIndex: number, delta: number) {
    const movedQuestions = moveNested(
      draft.sections.map((s) => s.questions),
      sIndex,
      qIndex,
      delta,
    )
    if (!movedQuestions) return

    const movedIds = moveNested(optionIdsRef.current!, sIndex, qIndex, delta)
    if (movedIds) optionIdsRef.current = movedIds
    const movedQuestionIds = moveNested(questionIdsRef.current!, sIndex, qIndex, delta)
    if (movedQuestionIds) questionIdsRef.current = movedQuestionIds

    setSectionsRemapped(
      draft.sections.map((s, i) => ({ ...s, questions: movedQuestions[i] })),
      sameSections(),
    )
  }

  function removeQuestion(sIndex: number, qIndex: number) {
    keepScroll()
    optionIdsRef.current![sIndex] = optionIdsRef.current![sIndex].filter((_, i) => i !== qIndex)
    questionIdsRef.current![sIndex] = questionIdsRef.current![sIndex].filter((_, i) => i !== qIndex)
    const questions = draft.sections[sIndex].questions.filter((_, i) => i !== qIndex)
    setSectionsRemapped(
      draft.sections.map((s, i) => (i === sIndex ? { ...s, questions } : s)),
      sameSections(),
    )
  }

  function addQuestion(sIndex: number) {
    keepScroll()
    optionIdsRef.current![sIndex] = [...optionIdsRef.current![sIndex], [makeLocalId('opt')]]
    questionIdsRef.current![sIndex] = [...questionIdsRef.current![sIndex], makeLocalId('q')]
    const questions = [...draft.sections[sIndex].questions, newQuestion()]
    setSectionsRemapped(
      draft.sections.map((s, i) => (i === sIndex ? { ...s, questions } : s)),
      sameSections(),
    )
  }

  function addSection() {
    keepScroll()
    optionIdsRef.current = [...optionIdsRef.current!, []]
    questionIdsRef.current = [...questionIdsRef.current!, []]
    sectionIdsRef.current = [...sectionIdsRef.current!, makeLocalId('sec')]
    setSectionsRemapped([...draft.sections, { questions: [] }], sameSections())
  }

  function moveSection(sIndex: number, delta: number) {
    const to = sIndex + delta
    if (to < 0 || to >= draft.sections.length) return
    optionIdsRef.current = moveItem(optionIdsRef.current!, sIndex, to)
    questionIdsRef.current = moveItem(questionIdsRef.current!, sIndex, to)
    sectionIdsRef.current = moveItem(sectionIdsRef.current!, sIndex, to)
    // 한 칸 이동이므로 sIndex 와 to 가 맞바뀌고 나머지는 제자리다.
    const sectionMap = draft.sections.map((_, i) => (i === sIndex ? to : i === to ? sIndex : i))
    setSectionsRemapped(moveItem(draft.sections, sIndex, to), sectionMap)
  }

  function removeSection(sIndex: number) {
    keepScroll()
    optionIdsRef.current = optionIdsRef.current!.filter((_, i) => i !== sIndex)
    questionIdsRef.current = questionIdsRef.current!.filter((_, i) => i !== sIndex)
    sectionIdsRef.current = sectionIdsRef.current!.filter((_, i) => i !== sIndex)
    const sectionMap = draft.sections.map((_, i) => (i === sIndex ? null : i > sIndex ? i - 1 : i))
    setSectionsRemapped(
      draft.sections.filter((_, i) => i !== sIndex),
      sectionMap,
    )
  }

  function patchOption(
    sIndex: number,
    qIndex: number,
    optionIndex: number,
    patch: Partial<QuestionDraft['options'][number]>,
  ) {
    const question = draft.sections[sIndex].questions[qIndex]
    patchQuestion(sIndex, qIndex, {
      options: question.options.map((o, i) => (i === optionIndex ? { ...o, ...patch } : o)),
    })
  }

  function moveOption(sIndex: number, qIndex: number, optionIndex: number, delta: number) {
    const question = draft.sections[sIndex].questions[qIndex]
    const newIndex = optionIndex + delta
    if (newIndex < 0 || newIndex >= question.options.length) return

    const ids = optionIdsRef.current![sIndex][qIndex]
    const optionId = ids[optionIndex]
    optionIdsRef.current![sIndex][qIndex] = moveItem(ids, optionIndex, newIndex)

    patchQuestion(sIndex, qIndex, {
      options: moveItem(question.options, optionIndex, newIndex),
    })
    pendingFocusRef.current = { optionId, dir: delta < 0 ? 'up' : 'down' }
  }

  function removeOption(sIndex: number, qIndex: number, optionIndex: number) {
    keepScroll()
    const question = draft.sections[sIndex].questions[qIndex]
    if (question.options.length <= 1) return
    optionIdsRef.current![sIndex][qIndex] = optionIdsRef.current![sIndex][qIndex].filter(
      (_, i) => i !== optionIndex,
    )
    patchQuestion(sIndex, qIndex, {
      options: question.options.filter((_, i) => i !== optionIndex),
    })
  }

  // 문항 번호는 설문 전체로 이어서 센다. 투표자에게는 섹션 이름이 보이지
  // 않으므로 그 사람이 세는 번호도 화면을 넘어서 이어진다 — 관리자가 보는
  // 번호가 그것과 어긋나면 "3번 문항이 이상해요"라는 말을 옮길 수 없다.
  const sectionOffsets = draft.sections.reduce<number[]>((acc, section, index) => {
    acc.push(index === 0 ? 0 : acc[index - 1] + draft.sections[index - 1].questions.length)
    return acc
  }, [])
  const lastSection = draft.sections.length - 1

  // 규칙은 섹션 경계를 세지 않는 평면 인덱스로 서로를 가리킨다. 그 순서가
  // 곧 sectionOffsets[sIndex] + qIndex 다 — flattenDraft 와 같은 순서로
  // 걷고 있어야 화면에서 고른 대상이 서버에서 다른 문항이 되지 않는다.
  const flat = flattenDraft(draft)

  // checkRules 는 서버 라우트가 저장 전에 부르는 바로 그 함수다(§rules.ts).
  // 같은 판단을 화면이 미리 해서, 관리자가 400 을 받기 전에 무엇이 깨졌는지
  // 그 자리에서 본다. 재매핑은 참조가 사라지는 것은 막지만 순서까지 지켜
  // 주지는 않는다 — 대상을 조건보다 앞으로 옮기면 참조는 살아 있는 채로
  // 제약만 깨진다.
  const ruleProblems = checkRules(draft)

  return (
    <>
      <div className="field-row">
        <label className="field-row__label" htmlFor="survey-title">
          설문 제목
        </label>
        <input
          id="survey-title"
          type="text"
          value={draft.title}
          disabled={locked}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </div>

      <div className="field-row">
        <label className="field-row__label" htmlFor="survey-description">
          설명
        </label>
        <textarea
          id="survey-description"
          rows={2}
          value={draft.description}
          disabled={locked}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </div>

      <div className="field-row">
        <label className="field-row__label" htmlFor="survey-visibility">
          결과 공개
        </label>
        <select
          id="survey-visibility"
          value={draft.resultsVisibility}
          onChange={(e) =>
            onChange({
              ...draft,
              resultsVisibility: e.target.value as SurveyDraftInput['resultsVisibility'],
            })
          }
        >
          <option value="admin">마감 후 관리자만</option>
          <option value="after_close">마감 후 모두에게</option>
        </select>
      </div>
      {/* 둘 다 "마감 후"다. 진행 중에는 관리자에게도 집계가 열리지 않는다
          (§ResultsVisibility) — 두 번 읽은 집계의 차이가 그 사이 들어온 한
          표이고, 참가자 화면이 그 표에 이름을 붙이기 때문이다. */}
      {flat.some((f) => (f.question.rules ?? []).length > 0) && (
        <p className="notice notice--warn">
          조건으로 갈린 문항은 해당자가 한두 명뿐이면 그 사람의 답이 그대로 드러나요.
        </p>
      )}

      {draft.sections.map((section, sIndex) => {
        const offset = sectionOffsets[sIndex]
        return (
          <fieldset key={sectionIdsRef.current![sIndex]} className="section-editor">
            {/* 섹션에는 제목이 없다(§SectionDef). 그래서 이 머리글은 투표
                화면에 나가는 글이 아니라 편집 중인 관리자만 보는 자리
                표시다 — "여기서 화면이 끊긴다"는 사실만 말한다. */}
            <legend className="section-editor__head">
              섹션 {sIndex + 1}
              <span className="section-editor__note">
                · 화면 한 장 · 문항 {section.questions.length}개
              </span>
            </legend>

            <div className="action-row">
              <button
                type="button"
                className="mini-btn"
                aria-label={`섹션 ${sIndex + 1} 위로 이동`}
                disabled={locked || sIndex === 0}
                onClick={() => moveSection(sIndex, -1)}
              >
                위로
              </button>
              <button
                type="button"
                className="mini-btn"
                aria-label={`섹션 ${sIndex + 1} 아래로 이동`}
                disabled={locked || sIndex === lastSection}
                onClick={() => moveSection(sIndex, 1)}
              >
                아래로
              </button>
              <button
                type="button"
                className="mini-btn"
                aria-label={`섹션 ${sIndex + 1} 삭제`}
                // 마지막 섹션은 지우지 못한다 — 지우면 문항을 넣을 자리가
                // 없는 설문이 되고, 편집기는 「문항 추가」 버튼조차 걸 곳이
                // 없어진다.
                disabled={locked || draft.sections.length <= 1}
                onClick={() => removeSection(sIndex)}
              >
                섹션 삭제
              </button>
            </div>

            {section.questions.map((question, qIndex) => {
              // flattenDraft 와 같은 순서다(섹션 순 · 문항 순). 규칙이 쓰는
              // 인덱스가 이것이므로 번호(number)도 여기서 나온다.
              const flatIndex = offset + qIndex
              const number = flatIndex + 1
              const idBase = `q-${sIndex}-${qIndex}`
              const optionIds = optionIdsRef.current![sIndex][qIndex]
              return (
                <fieldset
                  key={questionIdsRef.current![sIndex][qIndex]}
                  className="question-editor"
                >
                  <legend className="question-editor__head">
                    {number}번 문항{' '}
                    <span className="question-editor__type">· {TYPE_LABELS[question.type]}</span>
                  </legend>

                  {/* 규칙은 소스 문항 아래에 있지만, 「이 문항이 왜 안
                      보였지?」를 묻는 사람은 대상 문항 자리를 본다. 그
                      자리에서 읽히게 한다. */}
                  {(() => {
                    // 이 문항이나 이 문항이 속한 화면을 조종하는 규칙을 찾는다.
                    let found: { label: string; action: 'show' | 'hide' } | null = null
                    for (const f of flat) {
                      for (const rule of f.question.rules ?? []) {
                        const hit = rule.targets.some((target) =>
                          target.kind === 'question'
                            ? target.questionIndex === flatIndex
                            : target.sectionIndex === sIndex,
                        )
                        if (hit) found = { label: f.label, action: rule.action }
                      }
                    }
                    if (!found) return null

                    const verb = found.action === 'show' ? '보임' : '숨김'

                    return <p className="rule-chip">{found.label} 조건이 맞을 때 {verb}</p>
                  })()}

                  <div className="field-row">
                    <label className="field-row__label" htmlFor={`${idBase}-title`}>
                      문항 제목
                    </label>
                    <input
                      id={`${idBase}-title`}
                      type="text"
                      value={question.title}
                      disabled={locked}
                      onChange={(e) => patchQuestion(sIndex, qIndex, { title: e.target.value })}
                    />
                  </div>

                  {/* 설명은 투표 화면에서 제목 아래 작은 글씨로 나간다
                      (§ChoiceQuestion). 「보기를 두 개까지 고르세요」처럼
                      제목에 넣으면 제목이 길어지는 말의 자리다. */}
                  <div className="field-row">
                    <label className="field-row__label" htmlFor={`${idBase}-desc`}>
                      문항 설명
                    </label>
                    <textarea
                      id={`${idBase}-desc`}
                      rows={2}
                      value={question.description}
                      disabled={locked}
                      onChange={(e) =>
                        patchQuestion(sIndex, qIndex, { description: e.target.value })
                      }
                    />
                  </div>

                  <div className="field-row">
                    <label className="field-row__label" htmlFor={`${idBase}-type`}>
                      문항 형식
                    </label>
                    <select
                      id={`${idBase}-type`}
                      value={question.type}
                      disabled={locked}
                      onChange={(e) =>
                        patchQuestion(sIndex, qIndex, { type: e.target.value as QuestionType })
                      }
                    >
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="field-row field-row--inline" htmlFor={`${idBase}-required`}>
                    <input
                      id={`${idBase}-required`}
                      type="checkbox"
                      checked={question.required}
                      disabled={locked}
                      onChange={(e) => patchQuestion(sIndex, qIndex, { required: e.target.checked })}
                    />
                    필수 응답
                  </label>

                  {question.type === 'multi' && (
                    <div className="field-row field-row--split">
                      <div className="field-row">
                        <label className="field-row__label" htmlFor={`${idBase}-min`}>
                          최소 선택
                        </label>
                        <input
                          id={`${idBase}-min`}
                          type="text"
                          inputMode="numeric"
                          value={question.minSelect ?? ''}
                          disabled={locked}
                          onChange={(e) =>
                            patchQuestion(sIndex, qIndex, {
                              minSelect: toCount(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="field-row">
                        <label className="field-row__label" htmlFor={`${idBase}-max`}>
                          최대 선택
                        </label>
                        <input
                          id={`${idBase}-max`}
                          type="text"
                          inputMode="numeric"
                          value={question.maxSelect ?? ''}
                          disabled={locked}
                          onChange={(e) =>
                            patchQuestion(sIndex, qIndex, {
                              maxSelect: toCount(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {question.type !== 'text' && (
                    <>
                      {(question.type === 'single' || question.type === 'multi') && (
                        <label className="field-row field-row--inline" htmlFor={`${idBase}-other`}>
                          <input
                            id={`${idBase}-other`}
                            type="checkbox"
                            checked={question.allowOther}
                            disabled={locked}
                            onChange={(e) => {
                              const allowOther = e.target.checked
                              // 기타 입력을 끄면 답변할 방법이 없는 '기타 보기'가 남지 않도록
                              // 보기별 기타 표시도 함께 지운다.
                              const options = allowOther
                                ? question.options
                                : question.options.map((o) => ({ ...o, isOther: false }))
                              patchQuestion(sIndex, qIndex, { allowOther, options })
                            }}
                          />
                          기타 직접 입력 허용
                        </label>
                      )}

                      <p className="question-editor__options-label">보기</p>
                      <ul className="option-editor-list">
                        {question.options.map((option, optionIndex) => {
                          const optionId = optionIds[optionIndex]
                          return (
                            <li key={optionId} className="option-editor-row">
                              <span className="option-editor-row__index" aria-hidden="true">
                                {optionIndex + 1}
                              </span>
                              <label className="sr-only" htmlFor={`${idBase}-o-${optionIndex}`}>
                                보기 {optionIndex + 1}
                              </label>
                              <input
                                id={`${idBase}-o-${optionIndex}`}
                                type="text"
                                className="option-editor-row__input"
                                value={option.label}
                                disabled={locked}
                                onChange={(e) =>
                                  patchOption(sIndex, qIndex, optionIndex, {
                                    label: e.target.value,
                                  })
                                }
                              />
                              <label
                                className="option-editor-row__flag"
                                htmlFor={`${idBase}-o-${optionIndex}-other`}
                              >
                                <input
                                  id={`${idBase}-o-${optionIndex}-other`}
                                  type="checkbox"
                                  checked={option.isOther}
                                  disabled={locked}
                                  onChange={(e) => {
                                    const isOther = e.target.checked
                                    // 기타 보기로 표시하면서 문항이 기타 입력을 막고 있으면 함께 열어준다.
                                    // 그렇지 않으면 고를 수는 있지만 답할 방법이 없는 보기가 생긴다.
                                    patchQuestion(sIndex, qIndex, {
                                      allowOther: isOther ? true : question.allowOther,
                                      options: question.options.map((o, i) =>
                                        i === optionIndex ? { ...o, isOther } : o,
                                      ),
                                    })
                                  }}
                                />
                                이 보기를 기타로 사용
                              </label>
                              <span className="option-editor-row__actions">
                                <button
                                  type="button"
                                  className="mini-btn"
                                  ref={(el) => {
                                    optionButtonRefs.current.set(`${optionId}-up`, el)
                                  }}
                                  aria-label={`${number}번 문항 보기 ${optionIndex + 1} 위로 이동`}
                                  disabled={locked || optionIndex === 0}
                                  onClick={() => moveOption(sIndex, qIndex, optionIndex, -1)}
                                >
                                  위로
                                </button>
                                <button
                                  type="button"
                                  className="mini-btn"
                                  ref={(el) => {
                                    optionButtonRefs.current.set(`${optionId}-down`, el)
                                  }}
                                  aria-label={`${number}번 문항 보기 ${optionIndex + 1} 아래로 이동`}
                                  disabled={locked || optionIndex === question.options.length - 1}
                                  onClick={() => moveOption(sIndex, qIndex, optionIndex, 1)}
                                >
                                  아래로
                                </button>
                                <button
                                  type="button"
                                  className="mini-btn"
                                  aria-label={`${number}번 문항 보기 ${optionIndex + 1} 삭제`}
                                  disabled={locked || question.options.length <= 1}
                                  onClick={() => removeOption(sIndex, qIndex, optionIndex)}
                                >
                                  삭제
                                </button>
                              </span>
                            </li>
                          )
                        })}
                      </ul>

                      <button
                        type="button"
                        className="add-btn"
                        aria-label={`${number}번 문항에 보기 추가`}
                        disabled={locked}
                        onClick={() => {
                          keepScroll()
                          optionIdsRef.current![sIndex][qIndex] = [...optionIds, makeLocalId('opt')]
                          patchQuestion(sIndex, qIndex, {
                            options: [...question.options, { label: '', isOther: false }],
                          })
                        }}
                      >
                        보기 추가
                      </button>
                    </>
                  )}

                  {/* 규칙은 여러 개일 수 있다. 「예면 1번을 보임」과
                      「아니오면 2번을 보임」은 한 규칙의 AND/OR 로는 적을 수
                      없는, 조건이 서로 다른 두 규칙이다. */}
                  {(question.rules ?? []).map((rule, rIndex) => {
                    const choices = targetChoices(draft, flat, flatIndex, rule)
                    const selected = new Set(rule.targets.map(targetValue))
                    const ruleBase = `${idBase}-r${rIndex}`

                    return (
                      <div className="rule-card" key={rIndex}>
                        <div className="rule-card__head">
                          <p className="rule-card__name">조건 {rIndex + 1}</p>
                          <button
                            type="button"
                            className="mini-btn"
                            aria-label={`조건 ${rIndex + 1} 지우기`}
                            disabled={locked}
                            onClick={() => removeRule(sIndex, qIndex, rIndex)}
                          >
                            지우기
                          </button>
                        </div>

                        <div className="rule-card__part">
                          <p className="rule-card__lead">이 문항에서</p>

                          {rule.conditions.map((condition, cIndex) => (
                            <div className="rule-card__row" key={cIndex}>
                              {/* 보기가 먼저, 연산자가 뒤다 — 「이 문항에서
                                  [예] [고르면]」이 한국어 어순이다. */}
                              {!VALUELESS.includes(condition.operator) && (
                                <>
                                  <label className="sr-only" htmlFor={`${ruleBase}-c${cIndex}-v`}>
                                    조건 {rIndex + 1} 보기 {cIndex + 1}
                                  </label>
                                  <select
                                    id={`${ruleBase}-c${cIndex}-v`}
                                    value={condition.optionIndex ?? 0}
                                    disabled={locked}
                                    onChange={(e) =>
                                      patchCondition(sIndex, qIndex, rIndex, cIndex, {
                                        optionIndex: Number(e.target.value),
                                      })
                                    }
                                  >
                                    {question.options.map((option, index) => (
                                      <option key={index} value={index}>
                                        {option.label.trim() === ''
                                          ? `보기 ${index + 1}`
                                          : option.label}
                                      </option>
                                    ))}
                                  </select>
                                </>
                              )}

                              <label className="sr-only" htmlFor={`${ruleBase}-c${cIndex}-op`}>
                                조건 {rIndex + 1} 연산자 {cIndex + 1}
                              </label>
                              <select
                                id={`${ruleBase}-c${cIndex}-op`}
                                value={condition.operator}
                                disabled={locked}
                                onChange={(e) =>
                                  changeConditionOperator(
                                    sIndex,
                                    qIndex,
                                    rIndex,
                                    cIndex,
                                    e.target.value as ConditionOperator,
                                  )
                                }
                              >
                                {/* 조건이 보는 것은 언제나 이 문항의 답이다.
                                    그래서 연산자도 이 문항의 형식이 정한다. */}
                                {allowedOperators(question).map((op) => (
                                  <option key={op} value={op}>
                                    {OPERATOR_LABELS[op]}
                                  </option>
                                ))}
                              </select>

                              {/* 줄이 하나뿐이면 지울 것이 규칙 전체다 — 그
                                  버튼은 카드 아래에 따로 있다. */}
                              {rule.conditions.length > 1 && (
                                <button
                                  type="button"
                                  className="mini-btn"
                                  aria-label={`조건 ${rIndex + 1} 줄 ${cIndex + 1} 삭제`}
                                  disabled={locked}
                                  onClick={() => removeCondition(sIndex, qIndex, rIndex, cIndex)}
                                >
                                  삭제
                                </button>
                              )}
                            </div>
                          ))}

                          <div className="rule-card__row">
                            <button
                              type="button"
                              className="add-btn"
                              disabled={locked || rule.conditions.length >= 8}
                              onClick={() => addCondition(sIndex, qIndex, rIndex)}
                            >
                              줄 추가
                            </button>

                            {/* 줄이 하나면 「모두」와 「하나라도」가 같은
                                말이다. 고를 것이 없는 드롭다운은 띄우지 않는다. */}
                            {rule.conditions.length > 1 && (
                              <>
                                <label className="sr-only" htmlFor={`${ruleBase}-match`}>
                                  조건 {rIndex + 1} 결합
                                </label>
                                <select
                                  id={`${ruleBase}-match`}
                                  value={rule.match}
                                  disabled={locked}
                                  onChange={(e) =>
                                    patchRule(sIndex, qIndex, rIndex, {
                                      match: e.target.value as 'all' | 'any',
                                    })
                                  }
                                >
                                  <option value="all">모두 만족</option>
                                  <option value="any">하나라도 만족</option>
                                </select>
                              </>
                            )}
                          </div>
                        </div>

                        <fieldset className="rule-card__part">
                          <legend className="rule-card__lead">그러면</legend>

                          <label className="sr-only" htmlFor={`${ruleBase}-action`}>
                            조건 {rIndex + 1} 동작
                          </label>
                          <select
                            id={`${ruleBase}-action`}
                            value={rule.action}
                            disabled={locked}
                            onChange={(e) =>
                              patchRule(sIndex, qIndex, rIndex, {
                                action: e.target.value as 'show' | 'hide',
                              })
                            }
                          >
                            <option value="show">보임</option>
                            <option value="hide">숨김</option>
                          </select>

                          {/* 체크박스가 여럿이면 여럿 고를 수 있다는 말을
                              한 줄로 적는다 — 라디오 버튼처럼 하나만
                              고르는 자리로 읽히던 자리다. */}
                          {choices.length > 1 && (
                            <p className="rule-card__hint">여러 개 고를 수 있어요</p>
                          )}

                          <div className="rule-card__targets">
                            {choices.map((choice) => (
                              <label className="rule-card__target" key={choice.value}>
                                <input
                                  type="checkbox"
                                  checked={selected.has(choice.value)}
                                  disabled={locked}
                                  onChange={(e) =>
                                    toggleTarget(
                                      sIndex,
                                      qIndex,
                                      rIndex,
                                      choice.value,
                                      e.target.checked,
                                    )
                                  }
                                />
                                {choice.label}
                              </label>
                            ))}
                          </div>
                        </fieldset>

                      </div>
                    )
                  })}

                  <button
                    type="button"
                    className="add-btn"
                    // 조종할 대상이 하나도 없으면(뒤에 아무것도 없는 마지막
                    // 문항) 눌러도 아무 일이 없다. 아무 일도 없는 버튼보다
                    // 잠긴 버튼이 정직하다.
                    disabled={
                      locked ||
                      !newRule(flat, flatIndex) ||
                      (question.rules ?? []).length >= 8
                    }
                    onClick={() => addRule(sIndex, qIndex, flatIndex)}
                  >
                    조건 추가
                  </button>

                  <div className="action-row">
                    {/* 섹션의 첫 문항에서 「위로」를 누르면 앞 섹션의 끝으로
                        건너간다(§moveNested). 그래서 이 버튼이 잠기는 것은
                        설문 전체의 첫 문항일 때뿐이다. */}
                    <button
                      type="button"
                      className="mini-btn"
                      aria-label={`${number}번 문항 위로 이동`}
                      onClick={() => moveQuestion(sIndex, qIndex, -1)}
                      disabled={locked || (sIndex === 0 && qIndex === 0)}
                    >
                      위로
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      aria-label={`${number}번 문항 아래로 이동`}
                      onClick={() => moveQuestion(sIndex, qIndex, 1)}
                      disabled={
                        locked || (sIndex === lastSection && qIndex === section.questions.length - 1)
                      }
                    >
                      아래로
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      aria-label={`${number}번 문항 삭제`}
                      disabled={locked}
                      onClick={() => removeQuestion(sIndex, qIndex)}
                    >
                      삭제
                    </button>
                  </div>
                </fieldset>
              )
            })}

            <button
              type="button"
              className="add-btn"
              aria-label={`섹션 ${sIndex + 1}에 문항 추가`}
              disabled={locked}
              onClick={() => addQuestion(sIndex)}
            >
              문항 추가
            </button>
          </fieldset>
        )
      })}

      <button type="button" className="add-btn" disabled={locked} onClick={addSection}>
        섹션 추가
      </button>

      {/* checkRules 는 문제를 문항 이름으로 말한다(‘수강합니까?’의 조건은 …).
          규칙 블록마다 같은 문장을 되풀이하면 멀쩡한 규칙 옆에도 남의 문제가
          서서 어느 규칙이 잘못됐는지 오히려 흐려진다 — 저장 버튼 바로 위에
          한 번, 전부 모아 놓는다. 서버도 같은 함수로 저장을 막는다. */}
      {ruleProblems.length > 0 && (
        <ul className="submit-errors" role="alert">
          {ruleProblems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </>
  )
}
