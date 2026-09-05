import type {
  ConditionOperator,
  QuestionDef,
  QuestionType,
  RuleDraft,
  RuleTargetDraft,
  SurveyDef,
  SurveyDraftInput,
} from './schema'

type QuestionDraft = SurveyDraftInput['sections'][number]['questions'][number]

export type Flat = {
  question: QuestionDraft
  /** allQuestions 순서의 평면 인덱스. */
  index: number
  sectionIndex: number
  /** 화면에 보여줄 이름. 오류 문구와 드롭다운에 쓴다. */
  label: string
}

/** 초안의 모든 문항을 화면 순서대로 펴고 섹션 위치를 함께 들고 다닌다. */
export function flattenDraft(draft: SurveyDraftInput): Flat[] {
  const flat: Flat[] = []
  draft.sections.forEach((section, sectionIndex) => {
    section.questions.forEach((question) => {
      flat.push({
        question,
        index: flat.length,
        sectionIndex,
        label: question.title.trim() === '' ? `${flat.length + 1}번 문항` : question.title,
      })
    })
  })
  return flat
}

/**
 * 참조 문항 타입별로 쓸 수 있는 연산자. 관리자 화면의 드롭다운도 이 표를
 * 그대로 쓴다 — 두 곳에 따로 적으면 화면에서 고를 수 있는 조건을 서버가
 * 거부하는 상태가 언젠가 생긴다.
 */
export const OPERATORS_BY_TYPE: Record<QuestionType, ConditionOperator[]> = {
  single: ['is', 'is_not', 'answered', 'not_answered'],
  multi: ['includes', 'not_includes', 'answered', 'not_answered'],
  text: ['answered', 'not_answered'],
  ranking: ['answered', 'not_answered'],
}

/** 값(보기)을 필요로 하지 않는 연산자. */
export const VALUELESS_OPERATORS: ConditionOperator[] = ['answered', 'not_answered']

/**
 * 초안의 조건 규칙들을 서로 맞춰 본다. 문제 문구 목록을 돌려주고, 빈 배열이면
 * 정상이다.
 *
 * Zod refine 이 아니라 별도 함수인 것은 관리자 화면도 같은 판단을 저장 전에
 * 화면에서 해야 하기 때문이다 — 서버가 400 을 돌려준 뒤에야 무엇이 잘못됐는지
 * 아는 편집기는 쓸 수 없다.
 */
export function checkRules(draft: SurveyDraftInput): string[] {
  const flat = flattenDraft(draft)
  const problems: string[] = []
  const claimedQuestions = new Set<number>()
  const claimedSections = new Set<number>()

  for (const owner of flat) {
    for (const rule of owner.question.rules ?? []) {
      if (rule.conditions.length === 0) {
        problems.push(`‘${owner.label}’의 조건이 비어 있어요.`)
        continue
      }
      if (rule.targets.length === 0) {
        problems.push(`‘${owner.label}’의 조건이 아무것도 가리키지 않아요.`)
        continue
      }

      // 대상은 실재하는가, 그리고 설문 전체에서 한 번만 지목됐는가. 한
      // 문항이 규칙을 여럿 가질 수 있으므로 이 검사가 유일한 충돌
      // 방지선이다 — 같은 규칙이 한 대상을 두 번 적은 경우도 여기서
      // 걸린다(같은 집합에 두 번 넣으려 하기 때문이다).
      for (const target of rule.targets) {
        if (target.kind === 'question') {
          const found = flat[target.questionIndex]
          if (!found) {
            problems.push(`‘${owner.label}’의 조건이 없는 문항을 가리키고 있어요.`)
            continue
          }
          if (claimedQuestions.has(target.questionIndex)) {
            problems.push(`‘${found.label}’을 두 조건이 함께 조종하고 있어요.`)
            continue
          }
          claimedQuestions.add(target.questionIndex)
          // 조건은 소유 문항의 답을 보므로, 그 답이 나오기 전에 지나간
          // 문항은 조종할 수 없다.
          if (found.index <= owner.index) {
            problems.push(
              `‘${owner.label}’의 조건은 뒤에 오는 문항만 조종할 수 있어요. 앞선 문항은 이미 지나갔어요.`,
            )
          }
        } else {
          const sectionIndex = target.sectionIndex
          if (sectionIndex >= draft.sections.length) {
            problems.push(`‘${owner.label}’의 조건이 없는 화면을 가리키고 있어요.`)
            continue
          }
          if (claimedSections.has(sectionIndex)) {
            problems.push(`${sectionIndex + 1}번째 화면을 두 조건이 함께 조종하고 있어요.`)
            continue
          }
          claimedSections.add(sectionIndex)
          // 화면 대상은 문항보다 한 칸 더 엄격하다: 소유 문항이 있는 화면
          // 자체를 그 화면 안의 답으로 지울 수는 없다.
          if (sectionIndex <= owner.sectionIndex) {
            problems.push(
              `‘${owner.label}’의 조건은 뒤에 오는 화면만 조종할 수 있어요. 자기 화면과 앞선 화면은 조종할 수 없어요.`,
            )
          }
        }
      }

      // 조건이 보는 것은 언제나 소유 문항의 답이다. 그래서 연산자와 보기도
      // 소유 문항에 비추어 본다.
      for (const condition of rule.conditions) {
        const allowed = OPERATORS_BY_TYPE[owner.question.type]
        if (!allowed.includes(condition.operator)) {
          problems.push(`‘${owner.label}’에는 쓸 수 없는 조건이에요.`)
          continue
        }

        if (VALUELESS_OPERATORS.includes(condition.operator)) {
          if (condition.optionIndex !== null) {
            problems.push(`‘${owner.label}’의 조건에는 보기를 고르지 않아요.`)
          }
          continue
        }

        if (
          condition.optionIndex === null ||
          condition.optionIndex >= owner.question.options.length
        ) {
          problems.push(`‘${owner.label}’의 조건이 없는 보기를 가리키고 있어요.`)
        }
      }
    }
  }

  return problems
}

/**
 * 저장된 설문(ID 참조)을 편집용 초안(인덱스 참조)으로 되돌린다.
 *
 * 이 변환이 한 곳에만 있어야 하는 이유는 규칙 때문이다. SurveyDef 의 규칙은
 * 문항·섹션·보기를 ID 로 가리키고 SurveyDraftInput 은 평면 인덱스로 가리키는데,
 * 옮기는 쪽에서 rule 한 줄을 빠뜨리면 그 초안을 저장하는 순간 설문의 모든
 * 조건이 조용히 사라진다 — 관리자는 제목 한 글자를 고치고 저장했을 뿐이라
 * 무엇이 없어졌는지 알 길이 없다. 관리자 화면(SurveyDetail)과 복제
 * (duplicateSurvey)가 둘 다 이 함수를 쓴다.
 *
 * 가리키던 것을 찾지 못한 조건과 대상은 그것만 버리고, 조건이나 대상이
 * 하나도 남지 않으면 규칙째 버린다 — 반쪽짜리 규칙은 저장이 거부된다.
 */
export function surveyToDraft(survey: SurveyDef): SurveyDraftInput {
  const flat = survey.sections.flatMap((section) => section.questions)
  const questionIndexById = new Map(flat.map((question, index) => [question.id, index]))
  const sectionIndexById = new Map(survey.sections.map((section, index) => [section.id, index]))

  function toRuleDrafts(question: QuestionDef): RuleDraft[] {
    return question.rules.flatMap((rule): RuleDraft[] => {
      const targets = rule.targets.flatMap((target): RuleTargetDraft[] => {
        if (target.kind === 'question') {
          const index = questionIndexById.get(target.questionId)
          return index === undefined ? [] : [{ kind: 'question', questionIndex: index }]
        }
        const index = sectionIndexById.get(target.sectionId)
        return index === undefined ? [] : [{ kind: 'section', sectionIndex: index }]
      })
      if (targets.length === 0) return []

      // 조건이 보는 것은 소유 문항의 답이므로 보기도 소유 문항에서 찾는다.
      const conditions = rule.conditions.flatMap((condition) => {
        const optionIndex =
          condition.optionId === null
            ? null
            : question.options.findIndex((o) => o.id === condition.optionId)
        if (optionIndex === -1) return []
        return [{ operator: condition.operator, optionIndex }]
      })
      if (conditions.length === 0) return []

      return [{ match: rule.match, action: rule.action, targets, conditions }]
    })
  }

  return {
    title: survey.title,
    description: survey.description,
    resultsVisibility: survey.resultsVisibility,
    sections: survey.sections.map((section) => ({
      questions: section.questions.map((question) => ({
        type: question.type,
        title: question.title,
        description: question.description,
        required: question.required,
        minSelect: question.minSelect,
        maxSelect: question.maxSelect,
        allowOther: question.allowOther,
        options: question.options.map((option) => ({
          label: option.label,
          isOther: option.isOther,
        })),
        rules: toRuleDrafts(question),
      })),
    })),
  }
}
