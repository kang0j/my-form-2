import type { CSSProperties } from 'react'
import type { QuestionResult } from '../../server/aggregate'

type Props = {
  submissionCount: number
  results: QuestionResult[]
}

/**
 * 선택형 결과 한 줄. 득표 자체가 벽보의 헤드라이너 문법이다: 1위 대비 득표
 * 비율(--mag)이 글자 크기를 정하고, 전체 응답 대비 득표 비율(--share)이
 * 아래 그려진 면의 너비를 정한다. 반올림된 진행 막대가 아니라 득표만큼
 * 칠해진 각진 필드.
 */
function ChoiceRow({
  label,
  count,
  submissionCount,
  mag,
}: {
  label: string
  count: number
  submissionCount: number
  mag: number
}) {
  const share = submissionCount === 0 ? 0 : count / submissionCount
  return (
    <li
      className="choice-result-row"
      style={{ '--mag': mag, '--share': share } as CSSProperties}
    >
      <div className="choice-result-row__head">
        <p className="choice-result-row__label">{label}</p>
        <strong className="choice-result-row__count">{count}명</strong>
      </div>
      <div className="choice-result-row__field" aria-hidden="true" />
    </li>
  )
}

function RankingRow({
  label,
  score,
  maxScore,
  distribution,
}: {
  label: string
  score: number
  maxScore: number
  distribution: number[]
}) {
  const mag = maxScore === 0 ? 0 : score / maxScore
  return (
    <li className="ranking-result-row" style={{ '--mag': mag } as CSSProperties}>
      <div className="ranking-result-row__head">
        <p className="ranking-result-row__label">{label}</p>
        <strong className="ranking-result-row__score">{score}점</strong>
      </div>
      <dl className="rank-distribution">
        {distribution.map((count, index) => (
          <div className="rank-distribution__cell" key={index}>
            <dt>{index + 1}위</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
    </li>
  )
}

function sortedChoiceCounts(
  counts: { optionId: string; label: string; count: number }[],
): { optionId: string; label: string; count: number }[] {
  return [...counts].sort((a, b) => b.count - a.count)
}

function maxOf(values: number[]): number {
  return Math.max(...values, 0)
}

export function ResultsView({ submissionCount, results }: Props) {
  if (submissionCount === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">아직 들어온 응답이 없어요.</p>
      </div>
    )
  }

  return (
    <>
      <p className="results-summary">제출 {submissionCount}건</p>

      {results.map((result) => {
        const choiceRows =
          result.type === 'single' || result.type === 'multi' ? sortedChoiceCounts(result.counts) : null
        const maxChoiceCount = choiceRows ? maxOf(choiceRows.map((c) => c.count)) : 0
        const maxScore = result.type === 'ranking' ? maxOf(result.scores.map((s) => s.score)) : 0

        return (
          <section key={result.questionId} className="results-question">
            <h2 className="results-question__title">{result.title}</h2>
            <p className="results-question__meta">
              {result.eligibleCount === submissionCount
                ? `응답 ${result.respondentCount}명`
                : `이 문항을 본 ${result.eligibleCount}명 중 ${result.respondentCount}명 응답`}
            </p>

            {(result.type === 'single' || result.type === 'multi') && (
              <>
                <ul className="choice-result-list">
                  {choiceRows!.map((entry) => (
                    <ChoiceRow
                      key={entry.optionId}
                      label={entry.label}
                      count={entry.count}
                      submissionCount={submissionCount}
                      mag={maxChoiceCount === 0 ? 0 : entry.count / maxChoiceCount}
                    />
                  ))}
                </ul>
                {result.otherTexts.length > 0 && (
                  <>
                    <p className="results-question__subhead">기타 입력</p>
                    <ul className="plain-list">
                      {result.otherTexts.map((text, index) => (
                        <li key={`${text}-${index}`}>{text}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {result.type === 'ranking' && (
              <ul className="ranking-result-list">
                {result.scores.map((entry) => (
                  <RankingRow
                    key={entry.optionId}
                    label={entry.label}
                    score={entry.score}
                    maxScore={maxScore}
                    distribution={entry.distribution}
                  />
                ))}
              </ul>
            )}

            {result.type === 'text' && (
              <ul className="plain-list">
                {result.texts.map((text, index) => (
                  <li key={`${text}-${index}`}>{text}</li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}
