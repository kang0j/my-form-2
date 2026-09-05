import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toPersisted } from '../../src/client/vote/draft'
import { VoteFlow } from '../../src/client/vote/VoteFlow'

// 문항 하나를 화면 한 장에 담는다 — 예전(문항당 한 페이지)과 같은 걸음이
// 되므로, 화면 사이 이동을 보는 시험들이 그대로 뜻을 유지한다. 한 화면에
// 문항이 여럿 놓이는 경우는 아래 sectioned* 설문으로 따로 본다.
function solo(...questions: unknown[]) {
  return questions.map((question, index) => ({
    id: `sec${index + 1}`,
    questions: [question],
  }))
}

const singleQ = {
  id: 'q1',
  type: 'single',
  title: '누구를 지지하십니까?',
  description: '',
  required: true,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  rules: [],
  options: [
    { id: 'o1', label: '후보 A', isOther: false },
    { id: 'o2', label: '후보 B', isOther: false },
  ],
}

const textQ = {
  id: 'q2',
  type: 'text',
  title: '하고 싶은 말',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  rules: [],
  options: [],
}

const secondSingleQ = {
  id: 'q2',
  type: 'single',
  title: '두 번째 질문입니다',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  rules: [],
  options: [
    { id: 'p1', label: '옵션 하나', isOther: false },
    { id: 'p2', label: '옵션 둘', isOther: false },
  ],
}

const thirdSingleQ = {
  id: 'q3',
  type: 'single',
  title: '세 번째 질문입니다',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  rules: [],
  options: [
    { id: 'z1', label: '옵션 셋', isOther: false },
    { id: 'z2', label: '옵션 넷', isOther: false },
  ],
}

const rankingQ = {
  id: 'q1',
  type: 'ranking',
  title: '선호 순위',
  description: '',
  required: true,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  rules: [],
  options: [
    { id: 'r1', label: '가', isOther: false },
    { id: 'r2', label: '나', isOther: false },
    { id: 'r3', label: '다', isOther: false },
  ],
}

const multiQ = {
  id: 'q1',
  type: 'multi',
  title: '좋아하는 색은?',
  description: '',
  required: true,
  minSelect: 2,
  maxSelect: null,
  allowOther: false,
  rules: [],
  options: [
    { id: 'o1', label: '빨강', isOther: false },
    { id: 'o2', label: '파랑', isOther: false },
    { id: 'o3', label: '초록', isOther: false },
  ],
}

const survey = {
  id: 's1',
  title: '동아리 회장 선거',
  description: '익명 투표입니다',
  status: 'open',
  resultsVisibility: 'after_close',
  closeAt: null,
  resultsAvailable: false,
  sections: solo(singleQ),
}

// 화면 두 장짜리 설문 — 화면 사이 이동, 검토 화면, 키보드 진행처럼 여러
// 화면을 오가는 동작은 한 장짜리로는 재현할 수 없어 따로 둔다.
const twoQuestionSurvey = { ...survey, sections: solo(singleQ, textQ) }

// 같은 타입(single) 문항이 연달아 있는 설문 — 시그니처 인터랙션(§fix 1)이
// "문항 타입이 바뀔 때만" 재생되는 게 아니라 매 턴 재생되는지 보려면
// 필요하다. 화면 3장짜리라 진행 표시가 표지·1·2·3·검토 다섯 걸음에서
// 각각 맞게 서는지(§fix 4)도 이걸로 확인한다.
const threeSameTypeSurvey = { ...survey, sections: solo(singleQ, secondSingleQ, thirdSingleQ) }

// 한 화면에 문항 셋 — 섹션이 하는 일 자체를 보는 설문. 가운데 문항만
// 필수라 섹션 단위 검증이 "화면 안 어느 문항이든" 잡는지 볼 수 있다.
const sectionedSurvey = {
  ...survey,
  sections: [
    {
      id: 'sec1',
      questions: [
        { ...singleQ, required: false },
        { ...secondSingleQ, id: 'q2', required: true },
        { ...thirdSingleQ, id: 'q3', required: false },
      ],
    },
    { id: 'sec2', questions: [textQ] },
  ],
}

// 조건 규칙이 하나 걸린 설문 — 1번의 답이 「후보 A」일 때만 2번이 보인다.
// 표지의 문항 수가 상한이라는 것(§hero__meta)을 이 설문으로 본다.
const ruledSurvey = {
  ...survey,
  sections: solo(
    {
      ...singleQ,
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: 'q2' }],
          conditions: [{ operator: 'is', optionId: 'o1' }],
        },
      ],
    },
    textQ,
  ),
}

// 랭킹 문항 하나짜리 설문 — 위/아래 버튼에 Enter 를 눌렀을 때 화면 전환용
// 가로채기가 그 버튼의 클릭을 삼키지 않는지(§C2) 보려면 필요하다.
const rankingSurvey = { ...survey, sections: solo(rankingQ) }

// 최소 2개를 골라야 하는 다중 선택 문항 하나짜리 설문 — 검토 화면에 도달한
// 뒤에 답을 무효로 만들 수 있어야 submit() 의 마지막 검증 게이트(§T1)를
// 시험할 수 있다. 라디오(단일 선택)는 이미 고른 것을 클릭으로 되돌릴 수
// 없어 이 목적에 못 쓴다.
const multiFirstSurvey = { ...survey, sections: solo(multiQ) }

let submitBody: Record<string, unknown> | null = null
let fetchMock: ReturnType<typeof vi.fn> | null = null

let checkBody: Record<string, unknown> | null = null

// POST 가 두 종류가 됐다: 표지의 허용 명단 조회(/check)와 제출(/submit).
// URL 로 갈라야 「시작하기」 한 번이 제출로 세어지지 않는다.
function mockFetch(
  overrides: { survey?: unknown; submit?: unknown; check?: unknown } = {},
) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith('/check')) {
      checkBody = JSON.parse(String(init.body))
      return new Response(JSON.stringify(overrides.check ?? { allowed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (init?.method === 'POST') {
      submitBody = JSON.parse(String(init.body))
      return new Response(
        JSON.stringify(overrides.submit ?? { ok: true, duplicateIdentity: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify(overrides.survey ?? survey), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function postCallCount(): number {
  return fetchMock!.mock.calls.filter(
    ([url, init]) =>
      (init as RequestInit | undefined)?.method === 'POST' && !String(url).endsWith('/check'),
  ).length
}

function renderFlow() {
  return render(
    <MemoryRouter initialEntries={['/s/s1']}>
      <Routes>
        <Route path="/s/:surveyId" element={<VoteFlow />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  submitBody = null
  checkBody = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * 표지에서 문항으로 들어간다.
 *
 * 「시작하기」와 1번 문항 사이에는 확인을 받아야 넘어가는 익명 안내가
 * 한 번 선다(§시작하기 직후의 익명 안내). 문항 이후를 검사하는 테스트는
 * 그 화면을 지나가야 하므로, 그 두 걸음을 여기 한 곳에 묶어 둔다 —
 * 안내 화면이 바뀌어도 고칠 곳이 한 군데다.
 */
async function pressStart() {
  await userEvent.click(screen.getByRole('button', { name: '시작하기' }))
  // 모달의 확인 버튼도 「시작하기」다 — 표지의 것과 이름이 같으므로 판
  // 안에서 찾는다.
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: '시작하기' }))
}

describe('표지', () => {
  it('제목과 설명을 보여준다', async () => {
    mockFetch()
    renderFlow()
    expect(await screen.findByText('동아리 회장 선거')).toBeInTheDocument()
    expect(screen.getByText('익명 투표입니다')).toBeInTheDocument()
  })

  // 「투표 중」 라벨은 걷어냈다(설문 이름 아래 곧바로 이름·학번이 오는
  // 화면이 이미 그렇게 말한다). 표지에는 상단 상태 줄 자체가 없다.
  it('상단에 「투표 중」 라벨을 두지 않는다', async () => {
    mockFetch()
    const { container } = renderFlow()
    await screen.findByText('동아리 회장 선거')
    expect(screen.queryByText('투표 중')).not.toBeInTheDocument()
    expect(container.querySelector('.status-row')).toBeNull()
  })

  // 표지는 문항 수를 아예 말하지 않는다. 조건이 걸리면 그 수는 상한일
  // 뿐이고, 「최대」를 붙이면 그 줄이 답하는 질문이 없어진다.
  it('표지는 문항 수를 말하지 않는다', async () => {
    mockFetch({ survey: ruledSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')

    expect(screen.queryByText(/문항 \d+개/)).not.toBeInTheDocument()
    expect(screen.queryByText(/문항 최대/)).not.toBeInTheDocument()
  })

  // 규칙이 없는 설문에서도 마찬가지다 — 화면 두 벌을 유지하지 않는다.
  it('규칙이 없는 설문의 표지에도 문항 수가 없다', async () => {
    mockFetch({ survey: twoQuestionSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')

    expect(screen.queryByText(/문항 \d+개/)).not.toBeInTheDocument()
  })

  // 탭 목록에서 어느 설문인지 갈리도록, 문서 제목이 설문 이름이 된다.
  it('문서 제목을 설문 이름으로 바꾼다', async () => {
    mockFetch()
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await waitFor(() => expect(document.title).toBe('동아리 회장 선거'))
  })

  it('이름과 학번을 채워야 시작할 수 있다', async () => {
    mockFetch()
    renderFlow()
    await screen.findByText('동아리 회장 선거')

    expect(screen.getByRole('button', { name: '시작하기' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    expect(screen.getByRole('button', { name: '시작하기' })).toBeEnabled()
  })

  // 익명성은 문구로 약속하는 것이 아니라 그림으로 보여야 한다
  // (PRODUCT.md §성공의 모습). 표지에서 글자로 된 설명이 되살아나면 그
  // 결정이 조용히 되돌려진 것이므로 함께 못박는다.
  it('표지에 글자로 된 익명성 설명을 두지 않는다', async () => {
    mockFetch()
    const { container } = renderFlow()
    await screen.findByText('동아리 회장 선거')

    expect(screen.queryByText(/이름과 학번은 참여 확인에만 쓰이며/)).not.toBeInTheDocument()

    // 도해에 남은 글자는 열 이름 둘뿐이다 — 두 덩이가 무엇인지 모르면 그림이
    // 해석되지 않으므로 이름만은 진짜 글자로 둔다. 무엇이 담기는지는 도형
    // 줄이 같은 모양으로 이미 보여주므로 부제도 두지 않는다.
    const stage = container.querySelector('.principle__stage')!
    expect(stage.textContent).toBe('참가자 명단응답')

    // 도형 줄 자체에는 글자가 한 자도 없다.
    expect(stage.querySelector('.stage__rows')!.textContent).toBe('')
  })

  it('도해는 aria-hidden 이고, 세 줄의 이음이 끊어지는 그림이다', async () => {
    mockFetch()
    const { container } = renderFlow()
    await screen.findByText('동아리 회장 선거')

    // 그림인 것은 도형 줄뿐이다 — 열 이름은 접근성 트리에 남아야 두 덩이가
    // 무엇인지 보조기기에도 전해진다.
    const stage = container.querySelector('.principle__stage')!
    const shapes = stage.querySelector('.stage__rows')!
    expect(shapes).toHaveAttribute('aria-hidden', 'true')
    expect(stage.querySelector('.stage__head')).not.toHaveAttribute('aria-hidden')

    // 한 줄 = [명부 기록] ─ [이음] ─ [응답 기록].
    const rows = [...shapes.querySelectorAll('.stage__row')]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      // 명부 기록은 이름·학번 두 칸으로 늘 같은 모양이다.
      expect(row.querySelectorAll('.stage__field')).toHaveLength(2)
      expect(row.querySelectorAll('.stage__answer')).toHaveLength(1)
      // 이음은 조각들로 쪼개져 있어야 가운데부터 지워질 수 있다 — 통짜
      // 막대 하나면 한꺼번에 꺼지는 것이지 끊어지는 것이 아니다.
      expect(row.querySelectorAll('.stage__seg').length).toBeGreaterThan(2)
    }

    const answers = rows.map((row) => row.querySelector<HTMLElement>('.stage__answer')!)

    // 응답 폭이 셋 다 달라야 자리를 바꾼 것이 눈에 보인다 — 같으면 섞여도
    // 그림이 그대로다.
    expect(new Set(answers.map((a) => a.style.getPropertyValue('--w'))).size).toBe(3)

    // 자리 바꿈은 순열이어야 한다: 자리가 비거나 겹치면 안 되고, 어떤 줄도
    // 제자리에 남으면 안 된다(남으면 그 줄만 짝이 되살아난다).
    const slots = answers.map((a, i) => i + Number(a.style.getPropertyValue('--shift')))
    expect([...slots].sort()).toEqual([0, 1, 2])
    slots.forEach((slot, i) => expect(slot).not.toBe(i))

    // 이 세계에는 아이콘·일러스트가 없다(§Don't) — 도해라고 예외를 두지 않는다.
    expect(stage.querySelector('svg, img')).toBeNull()
  })

  // 도해만 놓으면 "무엇이 따로 저장된다는 것인지"를 스스로 풀어내야 한다.
  // 그래서 그림이 하는 말을 눈에 보이는 한 줄로 받아 준다 — 보조기기용
  // 사본을 따로 두지 않으므로 이 한 문단이 양쪽을 다 맡는다.
  it('도해 아래에 그림이 하는 말을 한 줄로 적는다', async () => {
    mockFetch()
    const { container } = renderFlow()
    await screen.findByText('동아리 회장 선거')

    const note = container.querySelector('.principle__text')
    expect(note).not.toBeNull()
    expect(note!.textContent).toMatch(
      /참가자 정보는 명부에, 답변은 집계를 위한 응답에 따로 저장되어 작성자를 알 수 없습니다/,
    )
    // 눈에 보여야 한다 — 예전에는 sr-only 였다.
    expect(container.querySelector('.principle .sr-only')).toBeNull()
  })

  // 문장 전체가 요점이라 어느 조각을 굵게 해도 나머지가 곁가지로 읽힌다.
  it('그 문장에도, 모달의 같은 문장에도 굵은 조각을 두지 않는다', async () => {
    mockFetch()
    const { container } = renderFlow()
    await screen.findByText('동아리 회장 선거')

    expect(container.querySelector('.principle__text strong')).toBeNull()
  })

  it('도해 아래에 저장소 링크를 새 탭으로 단다', async () => {
    mockFetch()
    renderFlow()
    await screen.findByText('동아리 회장 선거')

    const link = screen.getByRole('link', { name: 'Github에서 소스코드 확인하기' })
    expect(link).toHaveAttribute('href', 'https://github.com/kang0j/my-form-2')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})

describe('응답과 제출', () => {
  async function startVoting() {
    mockFetch()
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
  }

  // 문항이 하나뿐인 설문에서는 그 문항이 곧 마지막 문항이라 버튼이
  // 「제출하기」이고, 누르면 그 자리에서 곧장 나간다 — 검토 화면은 없다.
  async function pressSubmit() {
    await userEvent.click(screen.getByRole('button', { name: '제출하기' }))
  }

  it('시작하면 문항이 보인다', async () => {
    await startVoting()
    expect(screen.getByText(/누구를 지지하십니까\?/)).toBeInTheDocument()
  })

  it('필수 문항을 비우고 다음으로 넘어가려 하면 막고 사유를 보여준다', async () => {
    await startVoting()
    await pressSubmit()

    expect(screen.getByText(/꼭 답해야 해요/)).toBeInTheDocument()
    // 아무것도 나가지 않고 문항 화면에 그대로 머문다.
    expect(screen.getByLabelText('후보 A')).toBeInTheDocument()
    expect(submitBody).toBeNull()
  })

  it('마지막 화면에서 제출하면 이름·학번·브라우저 키·답변을 함께 보낸다', async () => {
    await startVoting()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await pressSubmit()

    await waitFor(() => expect(submitBody).not.toBeNull())
    expect(submitBody).toMatchObject({
      name: '홍길동',
      studentId: '20250001',
      answers: [{ questionId: 'q1', type: 'single', optionId: 'o1' }],
    })
    expect(String(submitBody!.browserKey)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('제출하면 완료 화면이 나온다', async () => {
    await startVoting()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await pressSubmit()

    expect(await screen.findByText('제출했어요.')).toBeInTheDocument()
  })

  it('제출에 성공하면 저장된 초안을 지운다', async () => {
    await startVoting()
    await userEvent.click(screen.getByLabelText('후보 A'))
    expect(localStorage.getItem('anonymous-vote:draft:s1')).not.toBeNull()

    await pressSubmit()
    await waitFor(() => expect(submitBody).not.toBeNull())

    expect(localStorage.getItem('anonymous-vote:draft:s1')).toBeNull()
  })

  it('신원이 겹치면 관리자 확인 대상임을 알린다', async () => {
    vi.unstubAllGlobals()
    mockFetch({ submit: { ok: true, duplicateIdentity: true } })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await userEvent.click(screen.getByRole('button', { name: '제출하기' }))

    expect(await screen.findByText(/관리자가 한 번 더 확인해요/)).toBeInTheDocument()
  })
})

describe('문항 사이 이동', () => {
  async function startTwoQuestionVoting() {
    mockFetch({ survey: twoQuestionSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
  }

  it('다음 문항으로 넘어가고, 뒤로 가면 답이 그대로 남아 있다', async () => {
    await startTwoQuestionVoting()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    expect(screen.getByLabelText('하고 싶은 말')).toBeInTheDocument()
    expect(screen.queryByText(/누구를 지지하십니까\?/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(screen.getByText(/누구를 지지하십니까\?/)).toBeInTheDocument()
    expect(screen.getByLabelText('후보 A')).toBeChecked()
  })
})

describe('시그니처 인터랙션 — 문항 전환마다 재생된다 (§fix 1)', () => {
  it('같은 타입(single→single) 문항으로 넘어가도 제목이 새로 마운트되어 진입 애니메이션이 다시 트리거된다', async () => {
    mockFetch({ survey: threeSameTypeSurvey })
    const { container } = renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    const firstTitle = container.querySelector('.question-screen__title')
    expect(firstTitle).not.toBeNull()

    // 1번 문항은 필수라 답을 골라야 다음으로 넘어간다.
    await userEvent.click(screen.getByLabelText('후보 A'))

    // 두 문항 다 type: 'single' 이라 key 가 없다면 React 가 같은 DOM 을
    // 재사용해 CSS 애니메이션이 다시 트리거되지 않는다 — key={question.id}
    // 로 매 문항마다 서브트리를 새로 마운트해야 한다.
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('두 번째 질문입니다')).toBeInTheDocument()
    const secondTitle = container.querySelector('.question-screen__title')
    expect(secondTitle).not.toBeNull()
    expect(secondTitle).not.toBe(firstTitle)
  })
})

// 2026-09-03 계약 수정으로 바탕은 검정 상수가 됐다(Drenched·검정) — 벽
// 색이 걸음마다 이동하며 진행을 나르던 장치는 폐기됐다. 그 자리를 잠시
// 큰 숫자(「3 / 7」)가 물려받았지만, 조건 분기가 들어온 뒤로는 그 분모가
// 거짓말이 된다 — 지금은 진행률 바가 진다(§ProgressBar). 아래는 그 바가
// 걸음마다 서로 다른, 올바른 진행을 말하는지 본다.
describe('진행은 진행률 바가 짊어진다', () => {
  // 화면에서 숫자는 사라졌지만 정보는 사라지지 않았다 — aria-valuetext 가
  // 그 말을 그대로 한다. 그래서 시험도 그 문구를 읽는다.
  function progressText(): string {
    return screen.getByRole('progressbar').getAttribute('aria-valuetext') ?? ''
  }

  it('표지 → 화면1 → 화면2 → 화면3, 걸음마다 진행 표시가 맞게 바뀐다', async () => {
    mockFetch({ survey: threeSameTypeSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    // 표지는 아직 1번 문항에 들어서지 않았다 — 진행 표시 자체가 없어야
    // 한다(§fix 2026-09-03 「1/4 표지 거짓말」). 문항 수도 말하지 않는다.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/문항 \d+개/)).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
    // 실제로 1번 문항에 들어선 뒤에야 바가 나타난다.
    expect(progressText()).toBe('3화면 중 1번째')

    // 1번 문항은 필수라 답을 골라야 다음으로 넘어간다.
    await userEvent.click(screen.getByLabelText('후보 A'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(progressText()).toBe('3화면 중 2번째')

    // 2번 화면은 필수도 아니고 아직 아무것도 안 골랐다 — 버튼이 그 사실을
    // 「건너뛰기」로 먼저 말한다.
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(progressText()).toBe('3화면 중 3번째')

    // 마지막 화면의 버튼은 「제출하기」다 — 검토 화면이 없으므로 여기서
    // 곧장 나간다.
    expect(screen.getByRole('button', { name: '제출하기' })).toBeInTheDocument()
  })

  // 진행 표시는 숫자가 아니라 바다. 조건 분기가 들어오면 「3 / 7」의 7이
  // 거짓말이 되고, 분모를 가시 화면 수로 다시 세면 답을 바꿀 때마다 그
  // 숫자가 튄다 — 바가 조금 되돌아가는 편이 훨씬 조용하다(§ProgressBar).
  it('진행 표시는 숫자가 아니라 진행률 바다', async () => {
    mockFetch({ survey: { ...survey, sections: solo(singleQ, secondSingleQ) } })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuetext', '2화면 중 1번째')
    // 숫자 「1 / 2」 는 화면에 없다.
    expect(screen.queryByText('1 / 2')).not.toBeInTheDocument()
  })

  // 왼쪽 「투표 중」 라벨을 걷어낸 뒤에도 진행 표시가 왼쪽으로 흘러내리지
  // 않고 상태 줄의 오른쪽 끝에 그대로 남는지 — space-between 대신
  // .progress 의 margin-left: auto 가 그 자리를 붙든다.
  it('문항 화면에는 「투표 중」 없이 진행률 바만 남고, 그 바가 상태 줄의 마지막 요소다', async () => {
    mockFetch({ survey: twoQuestionSurvey })
    const { container } = renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    expect(screen.queryByText('투표 중')).not.toBeInTheDocument()
    const row = container.querySelector('.status-row') as HTMLElement
    expect(row.lastElementChild).toHaveClass('progress')
    expect(progressText()).toBe('2화면 중 1번째')
  })

  // 표지의 도해는 스크롤 아래에 있어 그냥 지나칠 수 있다. 「시작하기」와
  // 1번 문항 사이에 확인을 받아야 넘어가는 화면을 한 번 세운다.
  describe('시작하기 직후의 익명 안내', () => {
    async function fillAndStart() {
      await screen.findByText('동아리 회장 선거')
      await userEvent.type(screen.getByLabelText('이름'), '홍길동')
      await userEvent.type(screen.getByLabelText('학번'), '20250001')
      await userEvent.click(screen.getByRole('button', { name: '시작하기' }))
    }

    it('시작하기를 누르면 문항이 아니라 익명 안내가 먼저 뜬다', async () => {
      mockFetch({ survey: twoQuestionSurvey })
      const { container } = renderFlow()
      await fillAndStart()

      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(within(dialog).getByText('참가자와 응답이 연결되지 않습니다.')).toBeInTheDocument()
      // 표지에서 본 그림을 그대로 다시 쓴다 — 처음 보는 그림이면 확인하는
      // 데 시간이 걸린다.
      expect(dialog.querySelector('.principle__stage')).not.toBeNull()
      // 아직 문항으로 가지 않았다.
      expect(screen.queryByText('누구를 지지하십니까?')).not.toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    // 별도 페이지가 아니라 표지 위에 뜨는 판이다. 화면을 통째로 갈아
    // 끼우면 적어 둔 이름·학번이 사라진 것처럼 보이고 되돌아올 곳이 눈에
    // 안 보인다 — 뒤의 표지는 가림막 아래 그대로 남는다.
    it('표지를 갈아 끼우지 않고 그 위에 판으로 뜬다', async () => {
      mockFetch({ survey: twoQuestionSurvey })
      renderFlow()
      await fillAndStart()

      const dialog = await screen.findByRole('dialog')
      expect(dialog.parentElement).toHaveClass('anon-scrim')

      // 뒤의 표지는 사라지지 않았고, 적어 둔 이름·학번도 그대로다.
      expect(screen.getByLabelText('이름')).toHaveValue('홍길동')
      expect(screen.getByLabelText('학번')).toHaveValue('20250001')
      // 표지의 「시작하기」와 판의 「시작하기」가 둘 다 문서에 있다 —
      // 판이 표지를 갈아 끼운 것이 아니라 그 위에 떴다는 뜻이다.
      expect(screen.getAllByRole('button', { name: '시작하기' })).toHaveLength(2)
    })

    // 표지와 같은 문장이고, 표지와 같이 굵은 조각을 두지 않는다.
    it('같은 문장을 굵은 조각 없이 적는다', async () => {
      mockFetch({ survey: twoQuestionSurvey })
      const { container } = renderFlow()
      await fillAndStart()
      await screen.findByRole('dialog')

      const text = container.querySelector('.anon-dialog__text')
      expect(text).not.toBeNull()
      expect(text!.textContent).toMatch(
        /참가자 정보는 명부에, 답변은 집계를 위한 응답에 따로 저장되어 작성자를 알 수 없습니다/,
      )
      expect(text!.querySelector('strong')).toBeNull()
    })

    it('확인을 눌러야 1번 문항으로 넘어간다', async () => {
      mockFetch({ survey: twoQuestionSurvey })
      renderFlow()
      await fillAndStart()
      await screen.findByRole('dialog')

      const dialog = screen.getByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: '시작하기' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByText('누구를 지지하십니까?')).toBeInTheDocument()
    })

    // 확인을 우회하는 길이 아니라 갇히지 않게 하는 문이다 — 표지로만 돌린다.
    it('뒤로를 누르면 표지로 돌아가고 문항으로 가지 않는다', async () => {
      mockFetch({ survey: twoQuestionSurvey })
      renderFlow()
      await fillAndStart()
      const dialog = await screen.findByRole('dialog')

      await userEvent.click(within(dialog).getByRole('button', { name: '뒤로' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('누구를 지지하십니까?')).not.toBeInTheDocument()
      // 적어 둔 이름·학번은 그대로 남아 곧바로 다시 시작할 수 있다.
      expect(screen.getByLabelText('이름')).toHaveValue('홍길동')
    })

    // 공용 노트북 하나를 여럿이 돌려 쓰는 것이 정상 사용이다(PRODUCT.md).
    // 기기당 한 번만 띄우면 두 번째 사람은 이 화면을 못 본다.
    it('같은 기기에서 다시 시작해도 매번 뜬다', async () => {
      mockFetch({ survey: twoQuestionSurvey })
      renderFlow()
      await fillAndStart()
      await screen.findByRole('dialog')
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '뒤로' }))

      await userEvent.click(screen.getByRole('button', { name: '시작하기' }))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })

    // 화면은 덮여 있는데 포커스가 뒤의 표지에 남아 있으면, 키보드·스크린리더
    // 사용자에게는 그 순간 이 화면이 사라진 것과 같다.
    it('포커스를 확인 버튼에 두고 Escape 로 닫는다', async () => {
      mockFetch({ survey: twoQuestionSurvey })
      renderFlow()
      await fillAndStart()
      await screen.findByRole('dialog')

      expect(within(screen.getByRole('dialog')).getByRole('button', { name: '시작하기' })).toHaveFocus()

      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('누구를 지지하십니까?')).not.toBeInTheDocument()
    })
  })

  it('표지 화면은 진행을 자칭하지 않는다', async () => {
    mockFetch({ survey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    // 바도 없고, 옛 카운터가 남긴 "1 / 1" 같은 문자열도 문서 어디에도
    // 없어야 한다.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\d+ \/ \d+$/)).toBeNull()
  })
})

describe('검정 바탕을 문서 캔버스에도 칠한다', () => {
  it('투표 화면이 떠 있는 동안 body 배경이 검정이고, 벗어나면 원래대로 지워진다', async () => {
    mockFetch()
    const { unmount } = renderFlow()
    await screen.findByText('동아리 회장 선거')

    // 바탕은 처음부터 끝까지 움직이지 않는 검정 상수다(#0A0A0A).
    expect(document.body.style.backgroundColor).toBe('rgb(10, 10, 10)')
    expect(document.documentElement.style.backgroundColor).toBe('rgb(10, 10, 10)')

    unmount()

    // 화면을 벗어나면 인라인 값을 지워, 종이 세계의 기본 배경(스타일시트의
    // body { background: var(--paper) })이 다시 보이게 한다.
    expect(document.body.style.backgroundColor).toBe('')
    expect(document.documentElement.style.backgroundColor).toBe('')
  })
})

describe('키보드로 진행', () => {
  it('Enter 로 다음 화면으로 넘어가고, Shift+Enter 로 되돌아간다', async () => {
    mockFetch({ survey: twoQuestionSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    await userEvent.click(screen.getByLabelText('후보 A'))
    expect(screen.getByLabelText('후보 A')).toBeChecked()

    await userEvent.keyboard('{Enter}')
    expect(await screen.findByLabelText('하고 싶은 말')).toBeInTheDocument()

    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(await screen.findByText(/누구를 지지하십니까\?/)).toBeInTheDocument()
    expect(screen.getByLabelText('후보 A')).toBeChecked()
  })

  // 숫자 키로 보기를 고르던 단축키는 없앴다. 화면에 문항이 하나뿐일 때만
  // "3 을 누르면 3번 보기"가 뜻이 통했다 — 문항이 여럿 쌓인 화면에서 그
  // 숫자는 어느 문항의 보기인지 말해주지 못한다.
  it('숫자 키는 보기를 고르지 않는다', async () => {
    mockFetch({ survey: sectionedSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    await userEvent.keyboard('1')

    expect(screen.getByLabelText('후보 A')).not.toBeChecked()
  })
})

describe('재방문', () => {
  it('이미 제출한 기기에는 안내와 추가 제출 버튼을 보여준다', async () => {
    localStorage.setItem('anonymous-vote:submitted:s1', '1')
    mockFetch()
    renderFlow()

    expect(await screen.findByText('이미 제출했어요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '추가 제출' })).toBeInTheDocument()
  })

  it('추가 제출을 누르면 표지로 넘어간다', async () => {
    localStorage.setItem('anonymous-vote:submitted:s1', '1')
    mockFetch()
    renderFlow()

    await userEvent.click(await screen.findByRole('button', { name: '추가 제출' }))
    expect(screen.getByLabelText('이름')).toBeInTheDocument()
  })
})

describe('공유 기기의 남은 초안', () => {
  it('이름·학번은 비워서 보여주고 답변만 복원한다', async () => {
    localStorage.setItem(
      'anonymous-vote:draft:s1',
      JSON.stringify({
        name: '이전 사람',
        studentId: '11112222',
        single: { q1: 'o1' },
        multi: {},
        other: {},
        text: {},
        ranking: {},
      }),
    )
    mockFetch()
    renderFlow()
    await screen.findByText('동아리 회장 선거')

    expect(screen.getByLabelText('이름')).toHaveValue('')
    expect(screen.getByLabelText('학번')).toHaveValue('')

    await userEvent.type(screen.getByLabelText('이름'), '새 사람')
    await userEvent.type(screen.getByLabelText('학번'), '20259999')
    await pressStart()

    expect(screen.getByLabelText('후보 A')).toBeChecked()
  })
})

describe('열리지 않은 설문', () => {
  // 제목 없이 "마감된 설문이에요." 만 서면, 링크를 받은 사람은 자기가 어느
  // 설문에 온 것인지 알 수 없다. 카카오톡에서 링크 여러 개를 받은 사람에게는
  // 그 한 줄이 어느 것의 마감인지도 말해 주지 못한다.
  it('마감된 설문에는 제목과 마감 안내를 보여준다', async () => {
    mockFetch({ survey: { ...survey, status: 'closed', questions: [], resultsAvailable: true } })
    renderFlow()

    expect(await screen.findByRole('heading', { name: '동아리 회장 선거' })).toBeInTheDocument()
    expect(screen.getByText('마감된 설문이에요.')).toBeInTheDocument()
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '결과 보기' })).toBeInTheDocument()
  })

  it('아직 열리지 않은 설문에도 제목과 안내를 보여준다', async () => {
    mockFetch({ survey: { ...survey, status: 'draft', questions: [] } })
    renderFlow()
    expect(await screen.findByRole('heading', { name: '동아리 회장 선거' })).toBeInTheDocument()
    expect(screen.getByText('아직 열리지 않은 설문이에요.')).toBeInTheDocument()
  })
})


describe('재진입 방지 (§C1)', () => {
  it('마지막 화면에서 Enter 를 연달아 눌러도 제출은 한 번만 나간다', async () => {
    mockFetch({ survey: twoQuestionSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    const reviewScreen = screen.getByLabelText('하고 싶은 말').closest('.question-screen') as HTMLElement
    // 세 번의 Enter 를 사이에 아무것도 기다리지 않고 연달아 보낸다 — 키
    // 자동반복이나 급한 두 번 탭이 그대로 재현된다. sending state 갱신을
    // 기다리지 않고 큐잉되는 것이 핵심이라, 각 호출 사이에 await 를 두지
    // 않는다.
    fireEvent.keyDown(reviewScreen, { key: 'Enter' })
    fireEvent.keyDown(reviewScreen, { key: 'Enter' })
    fireEvent.keyDown(reviewScreen, { key: 'Enter' })

    await waitFor(() => expect(submitBody).not.toBeNull())
    expect(postCallCount()).toBe(1)
  })
})

describe('문항 화면의 다른 버튼에 포커스가 있을 때 Enter (§C2)', () => {
  it('랭킹 문항의 위로 버튼에 포커스가 있을 때 Enter 를 누르면 순서만 바뀌고 다음으로 넘어가지 않는다', async () => {
    mockFetch({ survey: rankingSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    const upButton = screen.getByRole('button', { name: '나 위로' })
    upButton.focus()
    await userEvent.keyboard('{Enter}')

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('나')
    // 문항 화면에 그대로 머문다 — 제출도 나가지 않았다.
    expect(screen.getByText('선호 순위')).toBeInTheDocument()
    expect(submitBody).toBeNull()
  })
})

describe('주관식 textarea 에서 Enter (§I1)', () => {
  it('Enter 는 줄바꿈으로 들어가고 화면을 넘기지 않는다', async () => {
    mockFetch({ survey: twoQuestionSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    const textarea = screen.getByLabelText('하고 싶은 말')
    await userEvent.type(textarea, '첫 줄{Enter}둘째 줄')

    expect(textarea).toHaveValue('첫 줄\n둘째 줄')
    // 화면을 넘기지 않고 같은 문항에 남아 있다.
    expect(screen.getByLabelText('하고 싶은 말')).toBeInTheDocument()
  })
})

describe('문항이 없는 설문 (§I4)', () => {
  // 물을 것이 없는 설문에는 머물 화면도 없다 — 익명 안내를 확인하는 순간
  // 그대로 제출한다.
  it('안내를 확인하면 곧장 제출되고 완료 화면이 뜬다', async () => {
    mockFetch({ survey: { ...survey, sections: [] } })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    expect(await screen.findByText('제출했어요.')).toBeInTheDocument()
    await waitFor(() => expect(submitBody).not.toBeNull())
    expect(submitBody!.answers).toEqual([])
  })
})

describe('제출 시점 검증 게이트 (§T1, §T5)', () => {
  // 마지막 화면의 버튼은 곧 제출이다. 무효한 답이 그 버튼을 통과해서는 안
  // 된다 — 문항 검증에 걸리면 아무것도 나가지 않고 그 문항이 사유를 말한다.
  it('무효한 다중 선택은 제출 버튼을 눌러도 나가지 않는다', async () => {
    mockFetch({ survey: multiFirstSurvey })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    // minSelect 2 인데 하나만 고른다.
    await userEvent.click(screen.getByLabelText('빨강'))
    await userEvent.click(screen.getByRole('button', { name: '제출하기' }))

    expect(submitBody).toBeNull()
    expect(screen.getByText('좋아하는 색은?')).toBeInTheDocument()
    expect(screen.getByText(/최소 2개를 골라야 해요/)).toBeInTheDocument()
  })
})

describe('설문을 불러오지 못했을 때', () => {
  it('오류 메시지를 보여주고 표지로는 진행하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('네트워크에 연결할 수 없어요.')
      }),
    )
    renderFlow()

    expect(await screen.findByText('네트워크에 연결할 수 없어요.')).toBeInTheDocument()
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
  })

  it('서버가 오류 응답을 주면 그 메시지를 보여준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: '설문을 찾지 못했어요.' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    renderFlow()

    expect(await screen.findByText('설문을 찾지 못했어요.')).toBeInTheDocument()
  })
})

describe('제출이 실패했을 때', () => {
  it('오류를 문항 화면에 보여주고 완료 화면으로 넘어가지 않는다', async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // 표지의 허용 명단 조회는 통과시킨다 — 이 테스트가 보려는 것은
      // 제출이 실패했을 때의 화면이지 게이트가 아니다.
      if (init?.method === 'POST' && url.endsWith('/check')) {
        return new Response(JSON.stringify({ allowed: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: '제출하지 못했어요.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(twoQuestionSurvey), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    await userEvent.click(screen.getByRole('button', { name: '제출하기' }))

    expect(await screen.findByText('제출하지 못했어요.')).toBeInTheDocument()
    // 완료 화면으로 넘어가지 않았다 — 마지막 문항 화면에 그대로 머문다.
    expect(screen.getByLabelText('하고 싶은 말')).toBeInTheDocument()
    expect(screen.queryByText('제출했어요.')).not.toBeInTheDocument()
  })
})

describe('제출 요청이 오가는 동안 (sending)', () => {
  it('제출 버튼이 비활성화되고 라벨이 "제출하는 중…" 으로 바뀐다', async () => {
    let resolvePost: (() => void) | null = null
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // 표지 게이트는 곧바로 통과시키고, 붙잡아 두는 것은 제출뿐이다.
      if (init?.method === 'POST' && url.endsWith('/check')) {
        return new Response(JSON.stringify({ allowed: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (init?.method === 'POST') {
        submitBody = JSON.parse(String(init.body))
        return new Promise<Response>((resolve) => {
          resolvePost = () =>
            resolve(
              new Response(JSON.stringify({ ok: true, duplicateIdentity: false }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
        })
      }
      return new Response(JSON.stringify(twoQuestionSurvey), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
    await userEvent.click(screen.getByLabelText('후보 A'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    await userEvent.click(screen.getByRole('button', { name: '제출하기' }))

    const sendingButton = await screen.findByRole('button', { name: '제출하는 중…' })
    expect(sendingButton).toBeDisabled()

    resolvePost!()
    expect(await screen.findByText('제출했어요.')).toBeInTheDocument()
  })
})

describe('신원은 저장되지 않는다 — 쓰기 쪽 (§T2)', () => {
  it('이름·학번을 입력해도 localStorage 에 남는 초안에는 그 값이 없다', async () => {
    mockFetch()
    renderFlow()
    await screen.findByText('동아리 회장 선거')

    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')

    const raw = localStorage.getItem('anonymous-vote:draft:s1')
    expect(raw).not.toBeNull()
    const stored = JSON.parse(raw!) as Record<string, unknown>
    expect(stored).not.toHaveProperty('name')
    expect(stored).not.toHaveProperty('studentId')
  })

  it('toPersisted 는 이름·학번을 뺀 나머지만 남긴다', () => {
    const draft = {
      name: '홍길동',
      studentId: '20250001',
      single: { q1: 'o1' },
      multi: {},
      other: {},
      text: {},
      ranking: {},
    }
    const persisted = toPersisted(draft)
    expect(persisted).not.toHaveProperty('name')
    expect(persisted).not.toHaveProperty('studentId')
    expect(persisted).toEqual({ single: { q1: 'o1' }, multi: {}, other: {}, text: {}, ranking: {} })
  })
})

describe('허용 명단 게이트 (표지)', () => {
  async function fillIntro() {
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
  }

  it('「시작하기」를 누르면 이름·학번으로 명단을 조회한다', async () => {
    mockFetch()
    renderFlow()
    await fillIntro()
    await userEvent.click(screen.getByRole('button', { name: '시작하기' }))

    await waitFor(() => expect(checkBody).not.toBeNull())
    expect(checkBody).toEqual({ name: '홍길동', studentId: '20250001' })
  })

  it('명단에 있으면 1번 문항으로 넘어간다', async () => {
    mockFetch({ check: { allowed: true } })
    renderFlow()
    await fillIntro()
    await pressStart()

    expect(await screen.findByText('누구를 지지하십니까?')).toBeInTheDocument()
  })

  // 문항을 다 푼 뒤에 거부당하면 인앱 브라우저에서 되돌릴 방법이 없다.
  // 표지에 그대로 머물러야 이름·학번을 바로 고칠 수 있다.
  it('명단에 없으면 표지에 머물며 사유를 보여준다', async () => {
    mockFetch({ check: { allowed: false } })
    renderFlow()
    await fillIntro()
    await userEvent.click(screen.getByRole('button', { name: '시작하기' }))

    expect(
      await screen.findByText(/명단에 없는 이름·학번이에요/),
    ).toBeInTheDocument()
    expect(screen.queryByText('누구를 지지하십니까?')).not.toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('홍길동')
  })

  it('이름을 고치면 앞선 거부 문구가 사라진다', async () => {
    mockFetch({ check: { allowed: false } })
    renderFlow()
    await fillIntro()
    await userEvent.click(screen.getByRole('button', { name: '시작하기' }))
    await screen.findByText(/명단에 없는 이름·학번이에요/)

    await userEvent.type(screen.getByLabelText('이름'), '2')
    expect(screen.queryByText(/명단에 없는 이름·학번이에요/)).not.toBeInTheDocument()
  })

  it('조회가 실패하면 그 사유를 보여주고 표지에 머문다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ error: '서버에 문제가 생겼어요.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(survey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    renderFlow()
    await fillIntro()
    await userEvent.click(screen.getByRole('button', { name: '시작하기' }))

    expect(await screen.findByText('서버에 문제가 생겼어요.')).toBeInTheDocument()
    expect(screen.queryByText('누구를 지지하십니까?')).not.toBeInTheDocument()
  })

  // 느린 망에서 「시작하기」를 두 번 누르면 조회가 두 번 나가고, 그중
  // 늦게 온 답이 화면을 뒤집을 수 있다(§C1 의 sendingRef 와 같은 이유).
  it('조회가 오가는 동안 버튼을 잠근다', async () => {
    let release: (() => void) | null = null
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          await held
          return new Response(JSON.stringify({ allowed: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(survey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    renderFlow()
    await fillIntro()
    await userEvent.click(screen.getByRole('button', { name: '시작하기' }))

    const button = await screen.findByRole('button', { name: '확인하는 중…' })
    expect(button).toBeDisabled()

    release!()
    // 조회가 끝나면 익명 안내가 서고, 확인해야 1번 문항으로 간다.
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '시작하기' }))
    expect(await screen.findByText('누구를 지지하십니까?')).toBeInTheDocument()
  })
})

describe('섹션 — 화면 한 장에 문항 여럿', () => {
  async function enter(surveyDef: unknown = sectionedSurvey) {
    mockFetch({ survey: surveyDef })
    const view = renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()
    return view
  }

  // 보기를 고르면 그 아래 문항으로 화면이 내려간다. jsdom 에는
  // scrollIntoView 가 없으므로 심어 두고, 어느 요소가 불렸는지로 확인한다.
  it('객관식(하나)의 보기를 고르면 다음 문항으로 내려간다', async () => {
    const calls: HTMLElement[] = []
    const original = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      function scrollIntoViewStub(this: HTMLElement) {
        calls.push(this)
      }

    try {
      await enter()
      const second = screen.getByText(/두 번째 질문입니다/).closest('.question-block')

      await userEvent.click(screen.getByLabelText('후보 A'))

      expect(calls.at(-1)).toBe(second)
    } finally {
      if (original === undefined) {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      } else {
        ;(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = original
      }
    }
  })

  // 여러 개 고르기는 첫 보기를 누른 순간 아직 고르는 중이다 — 화면이 끌고
  // 내려가면 나머지를 고를 자리가 사라진다.
  it('여러 개 고르기에서는 화면을 끌고 내려가지 않는다', async () => {
    const calls: HTMLElement[] = []
    const original = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      function scrollIntoViewStub(this: HTMLElement) {
        calls.push(this)
      }

    try {
      mockFetch({ survey: multiFirstSurvey })
      renderFlow()
      await screen.findByText('동아리 회장 선거')
      await userEvent.type(screen.getByLabelText('이름'), '홍길동')
      await userEvent.type(screen.getByLabelText('학번'), '20250001')
      await pressStart()

      await userEvent.click(screen.getByLabelText('빨강'))

      expect(calls).toEqual([])
    } finally {
      if (original === undefined) {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      } else {
        ;(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = original
      }
    }
  })

  it('한 섹션의 문항이 한 화면에 모두 선다', async () => {
    await enter()

    expect(screen.getByText(/누구를 지지하십니까\?/)).toBeInTheDocument()
    expect(screen.getByText(/두 번째 질문입니다/)).toBeInTheDocument()
    expect(screen.getByText(/세 번째 질문입니다/)).toBeInTheDocument()
    // 다음 섹션의 문항은 아직 없다 — 화면이 끊기는 자리가 섹션이다.
    expect(screen.queryByLabelText('하고 싶은 말')).not.toBeInTheDocument()
  })

  it('진행 표시가 세는 것은 문항이 아니라 화면이다', async () => {
    await enter()

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '2화면 중 1번째')

    await userEvent.click(screen.getByLabelText('옵션 하나'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '2화면 중 2번째')
  })

  it('섹션 안 어느 문항이든 걸리면 넘어가지 못하고, 문제는 그 문항 아래에 선다', async () => {
    const { container } = await enter()

    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    // 필수는 가운데 문항 하나뿐이다.
    const problems = container.querySelectorAll('.inline-problem')
    expect(problems).toHaveLength(1)
    expect(problems[0].textContent).toMatch(/두 번째 질문입니다/)
    // 화면은 그대로다.
    expect(screen.getByText(/누구를 지지하십니까\?/)).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('옵션 하나'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    expect(await screen.findByLabelText('하고 싶은 말')).toBeInTheDocument()
  })

  it('마지막 화면의 버튼이 제출이고, 「뒤로」는 앞 화면을 그대로 되돌려 준다', async () => {
    await enter()
    await userEvent.click(screen.getByLabelText('옵션 하나'))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    expect(screen.getByRole('button', { name: '제출하기' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))
    // 첫 화면의 문항들이 그대로 서 있고, 고른 답도 남아 있다.
    expect(screen.getByText(/세 번째 질문입니다/)).toBeInTheDocument()
    expect(screen.getByLabelText('옵션 하나')).toBeChecked()
  })

  it('아무것도 고르지 않은 화면에서는 버튼이 「건너뛰기」로 선다', async () => {
    const optional = {
      ...survey,
      sections: [
        { id: 'sec1', questions: [{ ...singleQ, required: false }] },
        { id: 'sec2', questions: [textQ] },
      ],
    }
    await enter(optional)

    expect(screen.getByRole('button', { name: '건너뛰기' })).toBeInTheDocument()

    // 하나라도 고르면 그냥 「다음」이다.
    await userEvent.click(screen.getByLabelText('후보 A'))
    expect(screen.getByRole('button', { name: '다음' })).toBeInTheDocument()
  })

  it('필수 문항이 비어 있으면 건너뛸 수 없으므로 「다음」으로 둔다', async () => {
    await enter()

    // sectionedSurvey 의 첫 화면에는 필수 문항이 하나 있다.
    expect(screen.getByRole('button', { name: '다음' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '건너뛰기' })).not.toBeInTheDocument()
  })

  it('문항이 하나도 없는 섹션은 화면으로 세지 않는다', async () => {
    const withEmpty = {
      ...survey,
      sections: [
        { id: 'empty', questions: [] },
        { id: 'sec1', questions: [singleQ] },
      ],
    }
    await enter(withEmpty)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1화면 중 1번째')
    expect(screen.getByText(/누구를 지지하십니까\?/)).toBeInTheDocument()
  })
})

describe('조건부 문항', () => {
  const gate = {
    id: 'gate',
    type: 'single',
    title: '감염치료약학을 수강하십니까?',
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

  const branch = {
    id: 'branch',
    type: 'single',
    title: '시간 변경에 찬성하십니까?',
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

  const tail = {
    id: 'tail',
    type: 'text',
    title: '하고 싶은 말',
    description: '',
    required: false,
    minSelect: null,
    maxSelect: null,
    allowOther: false,
    options: [],
    rules: [],
  }

  it('같은 화면 안의 조건부 문항은 답에 따라 그 자리에서 나타난다', async () => {
    mockFetch({ survey: { ...survey, sections: [{ id: 'sec1', questions: [gate, branch] }] } })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    expect(screen.queryByText(/시간 변경에 찬성하십니까/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /예/ }))
    expect(await screen.findByText(/시간 변경에 찬성하십니까/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /아니오/ }))
    await waitFor(() =>
      expect(screen.queryByText(/시간 변경에 찬성하십니까/)).not.toBeInTheDocument(),
    )
  })

  it('숨은 화면은 통째로 건너뛴다', async () => {
    const sectionGate = {
      ...gate,
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'section', sectionId: 'sec2' }],
          conditions: [{ operator: 'is', optionId: 'yes' }],
        },
      ],
    }
    mockFetch({
      survey: {
        ...survey,
        sections: [
          { id: 'sec1', questions: [sectionGate] },
          { id: 'sec2', questions: [branch] },
          { id: 'sec3', questions: [tail] },
        ],
      },
    })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    await userEvent.click(screen.getByRole('radio', { name: /아니오/ }))
    await userEvent.click(screen.getByRole('button', { name: /다음|확인하기/ }))

    // sec2 를 건너뛰고 sec3 로 간다.
    expect(await screen.findByLabelText('하고 싶은 말')).toBeInTheDocument()
  })

  it('되돌리면 숨었던 문항의 답이 그대로 돌아온다', async () => {
    mockFetch({ survey: { ...survey, sections: [{ id: 'sec1', questions: [gate, branch] }] } })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    await userEvent.click(screen.getByRole('radio', { name: /예/ }))
    await userEvent.click(await screen.findByRole('radio', { name: /찬성/ }))
    await userEvent.click(screen.getByRole('radio', { name: /아니오/ }))
    await waitFor(() =>
      expect(screen.queryByText(/시간 변경에 찬성하십니까/)).not.toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('radio', { name: /예/ }))
    expect(await screen.findByRole('radio', { name: /찬성/ })).toBeChecked()
  })

  it('숨은 문항의 답은 제출에 실리지 않는다', async () => {
    mockFetch({ survey: { ...survey, sections: [{ id: 'sec1', questions: [gate, branch] }] } })
    renderFlow()
    await screen.findByText('동아리 회장 선거')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('학번'), '20250001')
    await pressStart()

    await userEvent.click(screen.getByRole('radio', { name: /아니오/ }))
    expect(screen.queryByText(/시간 변경에 찬성하십니까/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '제출하기' }))

    await waitFor(() => expect(submitBody).not.toBeNull())
    expect(submitBody!.answers).toEqual([
      { questionId: 'gate', type: 'single', optionId: 'no' },
    ])
  })
})
