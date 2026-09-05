import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { QuestionResult } from '../../src/server/aggregate'
import { ResultsView } from '../../src/client/results/ResultsView'

const results: QuestionResult[] = [
  {
    type: 'multi',
    questionId: 'q1',
    title: '좋아하는 것',
    respondentCount: 3,
    eligibleCount: 3,
    counts: [
      { optionId: 'o1', label: '사과', count: 2 },
      { optionId: 'o2', label: '기타', count: 1 },
    ],
    otherTexts: ['포도'],
  },
  {
    type: 'ranking',
    questionId: 'q2',
    title: '순위',
    respondentCount: 2,
    eligibleCount: 3,
    scores: [
      { optionId: 'r1', label: '가', score: 3, distribution: [2, 0] },
      { optionId: 'r2', label: '나', score: 1, distribution: [0, 2] },
    ],
  },
  {
    type: 'text',
    questionId: 'q3',
    title: '한마디',
    respondentCount: 1,
    eligibleCount: 3,
    texts: ['좋아요'],
  },
]

describe('ResultsView', () => {
  it('전체 제출 수를 보여준다', () => {
    render(<ResultsView submissionCount={3} results={results} />)
    expect(screen.getByText('제출 3건')).toBeInTheDocument()
  })

  it('선택형은 보기별 개수를 보여준다', () => {
    render(<ResultsView submissionCount={3} results={results} />)
    expect(screen.getByText('사과')).toBeInTheDocument()
    expect(screen.getByText('2명')).toBeInTheDocument()
  })

  it('기타 입력을 따로 보여준다', () => {
    render(<ResultsView submissionCount={3} results={results} />)
    expect(screen.getByText('포도')).toBeInTheDocument()
  })

  it('랭킹은 보르다 점수를 순서대로 보여준다', () => {
    render(<ResultsView submissionCount={3} results={results} />)
    expect(screen.getByText('3점')).toBeInTheDocument()
    expect(screen.getByText('1점')).toBeInTheDocument()
  })

  it('주관식은 답변 목록을 보여준다', () => {
    render(<ResultsView submissionCount={3} results={results} />)
    expect(screen.getByText('좋아요')).toBeInTheDocument()
  })

  it('응답이 없으면 안내를 보여준다', () => {
    render(<ResultsView submissionCount={0} results={[]} />)
    expect(screen.getByText('아직 들어온 응답이 없어요.')).toBeInTheDocument()
  })
})

// §T4 — 이전 테스트는 존재만 확인했지 순서는 보지 않아서, 랭킹 목록이
// 뒤집혀도 통과했다. 이번에 결과 컴포넌트 안에 클라이언트 사이드 정렬이
// 들어왔으니(선택형은 득표순), "주관식 응답의 위치는 응답자 순서를 담지
// 않는다"는 성질을 실제로 지키는지 — 그리고 랭킹처럼 정렬되면 안 되는
// 목록까지 덩달아 정렬되지 않는지를 렌더된 <li> 순서로 못박는다.
describe('목록 순서', () => {
  it('선택형은 입력 순서와 무관하게 득표가 많은 순으로 보여준다', () => {
    const reordered: QuestionResult[] = [
      {
        type: 'multi',
        questionId: 'q1',
        title: '좋아하는 것',
        respondentCount: 3,
        eligibleCount: 3,
        counts: [
          { optionId: 'o2', label: '기타', count: 1 },
          { optionId: 'o1', label: '사과', count: 2 },
        ],
        otherTexts: [],
      },
    ]
    render(<ResultsView submissionCount={3} results={reordered} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('사과')
    expect(items[1]).toHaveTextContent('기타')
  })

  it('랭킹은 재정렬하지 않고 서버가 준 순서를 그대로 보여준다', () => {
    const reordered: QuestionResult[] = [
      {
        type: 'ranking',
        questionId: 'q2',
        title: '순위',
        respondentCount: 2,
        eligibleCount: 3,
        scores: [
          { optionId: 'r2', label: '나', score: 1, distribution: [0, 2] },
          { optionId: 'r1', label: '가', score: 3, distribution: [2, 0] },
        ],
      },
    ]
    render(<ResultsView submissionCount={3} results={reordered} />)
    const items = screen.getAllByRole('listitem')
    // score 로 보면 '가'(3점)가 먼저여야 하지만, 이 컴포넌트는 랭킹을
    // 재정렬하지 않는다 — 입력 그대로 '나'가 먼저 나와야 한다.
    expect(items[0]).toHaveTextContent('나')
    expect(items[1]).toHaveTextContent('가')
  })

  it('주관식은 재정렬하지 않고 서버가 준 순서를 그대로 보여준다', () => {
    const reordered: QuestionResult[] = [
      {
        type: 'text',
        questionId: 'q3',
        title: '한마디',
        respondentCount: 2,
        eligibleCount: 3,
        texts: ['둘째 답변', '첫째 답변'],
      },
    ]
    render(<ResultsView submissionCount={3} results={reordered} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('둘째 답변')
    expect(items[1]).toHaveTextContent('첫째 답변')
  })
})

// §T8 — 조건에 걸린 문항은 분모가 전체 제출 수와 다르다. respondentCount 만
// 보여주면 "안 보여서 답이 없는 것"과 "보였는데 안 답한 것"이 뒤섞여 비율이
// 실제보다 낮아 보인다.
describe('조건부 문항의 분모', () => {
  it('조건에 걸린 문항은 본 사람 수를 함께 말한다', () => {
    render(
      <ResultsView
        results={[
          {
            questionId: 'branch',
            title: '찬성?',
            type: 'single',
            respondentCount: 9,
            eligibleCount: 12,
            counts: [],
            otherTexts: [],
          },
        ]}
        submissionCount={30}
      />,
    )
    expect(screen.getByText('이 문항을 본 12명 중 9명 응답')).toBeInTheDocument()
  })

  it('조건에 걸리지 않은 문항은 응답 수만 말한다', () => {
    render(
      <ResultsView
        results={[
          {
            questionId: 'plain',
            title: '찬성?',
            type: 'single',
            respondentCount: 9,
            eligibleCount: 30,
            counts: [],
            otherTexts: [],
          },
        ]}
        submissionCount={30}
      />,
    )
    expect(screen.getByText('응답 9명')).toBeInTheDocument()
  })
})
