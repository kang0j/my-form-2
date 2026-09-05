import { isAnswered } from './answered'
import { allQuestions } from './schema'
import type { AnswerInput, QuestionDef, SubmissionInput, SurveyDef } from './schema'
import { computeVisibility } from './visibility'

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

function checkOtherText(
  question: QuestionDef,
  selectedIds: string[],
  otherText: string | undefined,
  errors: string[],
): void {
  const otherOptionIds = question.options.filter((o) => o.isOther).map((o) => o.id)
  const pickedOther = selectedIds.some((id) => otherOptionIds.includes(id))

  // 기타로 표시된 보기를 고르는 것 자체는 allowOther 와 무관하게 허용한다.
  // 거부하는 것은 오직 실제 기타 텍스트가 들어오는 경우다(스펙 §7).
  if (!isBlank(otherText) && !question.allowOther) {
    errors.push(`‘${question.title}’ 문항에는 기타 내용을 적을 수 없어요.`)
    return
  }
  if (pickedOther && question.allowOther && isBlank(otherText)) {
    errors.push(`‘${question.title}’ 문항의 기타 내용을 적어 주세요.`)
  }
  if (!pickedOther && !isBlank(otherText)) {
    errors.push(`‘${question.title}’ 문항은 기타를 고르지 않았는데 기타 내용이 있어요.`)
  }
}

function validateAnswer(question: QuestionDef, answer: AnswerInput, errors: string[]): void {
  const optionIds = question.options.map((o) => o.id)

  switch (answer.type) {
    case 'single': {
      if (!optionIds.includes(answer.optionId)) {
        errors.push(`‘${question.title}’ 문항에 없는 보기를 골랐어요.`)
        return
      }
      checkOtherText(question, [answer.optionId], answer.otherText, errors)
      return
    }
    case 'multi': {
      const unknown = answer.optionIds.filter((id) => !optionIds.includes(id))
      if (unknown.length > 0) {
        errors.push(`‘${question.title}’ 문항에 없는 보기를 골랐어요.`)
        return
      }
      if (new Set(answer.optionIds).size !== answer.optionIds.length) {
        errors.push(`‘${question.title}’ 문항에서 같은 보기를 두 번 골랐어요.`)
        return
      }
      const count = answer.optionIds.length
      if (question.minSelect !== null && count < question.minSelect) {
        errors.push(`‘${question.title}’ 문항은 최소 ${question.minSelect}개를 골라야 해요.`)
      }
      if (question.maxSelect !== null && count > question.maxSelect) {
        errors.push(`‘${question.title}’ 문항은 최대 ${question.maxSelect}개까지 고를 수 있어요.`)
      }
      checkOtherText(question, answer.optionIds, answer.otherText, errors)
      return
    }
    case 'text': {
      return
    }
    case 'ranking': {
      const ordered = answer.order
      if (new Set(ordered).size !== ordered.length) {
        errors.push(`‘${question.title}’ 문항에 같은 항목이 두 번 들어 있어요.`)
        return
      }
      const sameSet =
        ordered.length === optionIds.length && ordered.every((id) => optionIds.includes(id))
      if (!sameSet) {
        errors.push(`‘${question.title}’ 문항은 모든 항목에 순위를 매겨야 해요.`)
      }
      return
    }
  }
}

export function validateSubmission(survey: SurveyDef, input: SubmissionInput): ValidationResult {
  if (survey.status !== 'open') {
    return { ok: false, errors: ['지금은 참여할 수 있는 설문이 아니에요.'] }
  }

  const errors: string[] = []
  // 섹션은 화면을 끊는 개념일 뿐이라 검증은 문항을 통째로 편 목록만 본다.
  const questions = allQuestions(survey)
  const questionsById = new Map(questions.map((q) => [q.id, q]))

  const seen = new Set<string>()
  for (const answer of input.answers) {
    if (!questionsById.has(answer.questionId)) {
      errors.push('이 설문에 없는 문항이 들어 있어요.')
      continue
    }
    if (seen.has(answer.questionId)) {
      errors.push('한 문항에 답이 두 개 넘게 들어 있어요.')
      continue
    }
    seen.add(answer.questionId)
  }

  const answersByQuestion = new Map(input.answers.map((a) => [a.questionId, a]))

  // 가시성은 제출된 답으로 서버가 다시 계산한다 — 클라이언트가 "이 문항은
  // 보였다"고 말하는 것을 믿지 않는다. 답 자체가 입력이므로 자기 정합적이다.
  const visible = computeVisibility(survey, answersByQuestion)

  for (const question of questions) {
    const answer = answersByQuestion.get(question.id)

    if (answer && answer.type !== question.type) {
      errors.push(`‘${question.title}’ 문항의 답 형식이 맞지 않아요.`)
      continue
    }

    if (!visible.questions.has(question.id)) {
      // 안 보인 문항에 답이 있으면 거부한다. 그런 행이 저장되면 "이 문항을
      // 본 사람 수"와 "답한 사람 수"가 어긋나 결과 해석이 깨진다.
      if (isAnswered(question, answer)) {
        errors.push(`‘${question.title}’ 문항은 조건이 맞지 않아 보이지 않았어요.`)
      }
      continue
    }

    if (!isAnswered(question, answer)) {
      if (question.required) {
        errors.push(`‘${question.title}’ 문항은 꼭 답해야 해요.`)
      }
      continue
    }

    validateAnswer(question, answer!, errors)
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
