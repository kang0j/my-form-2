import { isAnswered } from './answered'
import type { AnswerInput, ConditionDef, QuestionDef, RuleDef, SurveyDef } from './schema'

export type Visibility = {
  /** 보이는 섹션 id. */
  sections: Set<string>
  /** 보이는 문항 id. 숨은 섹션의 문항은 들어 있지 않다. */
  questions: Set<string>
}

/**
 * 설문과 지금까지의 답으로 무엇이 보이는지 정한다.
 *
 * 가시성의 유일한 권위다 — 투표 흐름, 문항별 검증, 서버의 제출 검증, 결과
 * 집계가 모두 이 함수를 부른다. 같은 판단을 두 번 적으면 언젠가 한쪽만
 * 고치게 되고, 그때 투표자가 보지 않은 문항이 "꼭 답해야 해요"로 막힌다.
 *
 * 조건은 항상 대상보다 앞을 가리키므로(스펙 §3.3) 한 번의 전방 패스로
 * 끝난다. 뒤를 가리키는 규칙을 애초에 저장할 수 없게 막는 것이 여기서
 * 되풀이 계산을 없앤다.
 */
export function computeVisibility(
  survey: SurveyDef,
  answers: Map<string, AnswerInput>,
): Visibility {
  const hiddenSections = new Set<string>()
  const hiddenQuestions = new Set<string>()

  // 1) 기본값. show 규칙의 대상은 조건이 맞기 전까지 숨어 있고, hide 규칙의
  //    대상은 조건이 맞기 전까지 보인다.
  for (const section of survey.sections) {
    for (const question of section.questions) {
      for (const rule of question.rules) {
        if (rule.action !== 'show') continue
        for (const target of rule.targets) {
          if (target.kind === 'section') hiddenSections.add(target.sectionId)
          else hiddenQuestions.add(target.questionId)
        }
      }
    }
  }

  const isVisible = (sectionId: string, questionId: string): boolean =>
    !hiddenSections.has(sectionId) && !hiddenQuestions.has(questionId)

  // 조건이 보는 것은 언제나 규칙을 소유한 문항의 답이다. 소유 문항이
  // 보이는지는 규칙을 발동시키는 쪽에서 한 번 본다 — 보지 못한 문항의
  // 답은 어떤 조건도 만족시키지 않는다(스펙 §3.5). 그러지 않으면 "안 본
  // 덕분에 나타나는" 연쇄가 생겨 관리자가 규칙을 따라갈 수 없다.
  function conditionHolds(owner: QuestionDef, condition: ConditionDef): boolean {
    const answer = answers.get(owner.id)
    const answered = isAnswered(owner, answer)

    switch (condition.operator) {
      case 'answered':
        return answered
      case 'not_answered':
        return !answered
      case 'is':
        return answered && answer?.type === 'single' && answer.optionId === condition.optionId
      case 'is_not':
        return answered && answer?.type === 'single' && answer.optionId !== condition.optionId
      case 'includes':
        return (
          answered &&
          answer?.type === 'multi' &&
          condition.optionId !== null &&
          answer.optionIds.includes(condition.optionId)
        )
      case 'not_includes':
        return (
          answered &&
          answer?.type === 'multi' &&
          condition.optionId !== null &&
          !answer.optionIds.includes(condition.optionId)
        )
    }
  }

  function ruleFires(owner: QuestionDef, rule: RuleDef): boolean {
    if (rule.conditions.length === 0) return false
    return rule.match === 'all'
      ? rule.conditions.every((condition) => conditionHolds(owner, condition))
      : rule.conditions.some((condition) => conditionHolds(owner, condition))
  }

  // 2) 화면 순서대로 한 번 훑으며 규칙을 발동시킨다.
  for (const section of survey.sections) {
    for (const question of section.questions) {
      if (question.rules.length === 0) continue
      // 투표자가 보지 못한 문항의 규칙은 발동하지 않는다 — 고르지도 못한
      // 답이 다른 문항을 조종해서는 안 된다.
      if (!isVisible(section.id, question.id)) continue

      for (const rule of question.rules) {
        if (!ruleFires(question, rule)) continue

        for (const target of rule.targets) {
          if (target.kind === 'section') {
            if (rule.action === 'show') hiddenSections.delete(target.sectionId)
            else hiddenSections.add(target.sectionId)
          } else {
            if (rule.action === 'show') hiddenQuestions.delete(target.questionId)
            else hiddenQuestions.add(target.questionId)
          }
        }
      }
    }
  }

  // 3) 집합으로 편다. 숨은 섹션의 문항은 문항 규칙이 무어라 하든 빠진다.
  const sections = new Set<string>()
  const questions = new Set<string>()
  for (const section of survey.sections) {
    if (hiddenSections.has(section.id)) continue
    sections.add(section.id)
    for (const question of section.questions) {
      if (!hiddenQuestions.has(question.id)) questions.add(question.id)
    }
  }

  return { sections, questions }
}
