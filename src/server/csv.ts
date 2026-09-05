import type { AnswerRow } from './aggregate'
import type { ParticipantRow } from './db/audit'
import { allQuestions } from '../shared/schema'
import type { QuestionDef, SurveyDef } from '../shared/schema'
import { formatKst } from '../shared/kst'

/** 첫 글자가 이 문자들이면 스프레드시트가 값을 수식으로 해석한다. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

function escapeCell(value: string): string {
  // 앞쪽 공백을 잘라내고 나서 검사한다: " =1+1" 처럼 수식 앞에 공백이
  // 붙은 값은 첫 글자만 보면 통과하지만, 일부 스프레드시트 리더는 셀을
  // 열 때 앞뒤 공백을 잘라내고 나서 값을 수식으로 해석한다.
  const safe = FORMULA_PREFIX.test(value.trimStart()) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** 앞의 BOM 은 엑셀이 UTF-8 한글을 깨뜨리지 않게 하기 위한 것이다. */
export function toCsv(rows: string[][]): string {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')
  return `\uFEFF${body}\r\n`
}

function renderCell(question: QuestionDef, rows: AnswerRow[]): string {
  const mine = rows.filter((r) => r.questionId === question.id)
  if (mine.length === 0) return ''

  if (question.type === 'text') {
    return mine.map((r) => r.textValue ?? '').join(' | ')
  }

  const labelOf = new Map(question.options.map((o) => [o.id, o]))

  if (question.type === 'ranking') {
    return [...mine]
      .sort((a, b) => (a.rankPosition ?? 0) - (b.rankPosition ?? 0))
      .map((r) => `${r.rankPosition}. ${labelOf.get(r.optionId ?? '')?.label ?? ''}`)
      .join(' | ')
  }

  return mine
    .map((r) => {
      const option = labelOf.get(r.optionId ?? '')
      if (!option) return ''
      return option.isOther && r.textValue ? `${option.label}(${r.textValue})` : option.label
    })
    .join(' | ')
}

export function buildResponsesCsv(survey: SurveyDef, rows: AnswerRow[]): string {
  const submissionIds = [...new Set(rows.map((r) => r.submissionId))].sort()

  // 열 순서는 투표 화면 순서 그대로다 — 섹션 경계는 CSV 에 남기지 않는다.
  // 섹션에는 이름이 없어서 남길 것이 "여기서 화면이 끊겼다"는 사실뿐인데,
  // 그것은 응답을 읽는 사람에게 아무 뜻도 없다.
  const questions = allQuestions(survey)
  const header = ['응답 ID', ...questions.map((q) => q.title)]
  const body = submissionIds.map((submissionId) => {
    const mine = rows.filter((r) => r.submissionId === submissionId)
    return [submissionId, ...questions.map((q) => renderCell(q, mine))]
  })

  return toCsv([header, ...body])
}

export function buildRosterCsv(participants: ParticipantRow[]): string {
  const header = ['이름', '학번', '제출 시각(KST)', 'IP 해시', 'UA 해시']
  const body = participants.map((p) => [
    p.name,
    p.studentId,
    formatKst(p.submittedAt),
    p.ipHash,
    p.uaHash,
  ])
  return toCsv([header, ...body])
}
