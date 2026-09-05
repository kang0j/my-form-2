import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SurveyDef, SurveyDraftInput } from '../../src/shared/schema'
import { SurveyEditor } from '../../src/client/admin/SurveyEditor'
import { AuditView } from '../../src/client/admin/AuditView'
import { SurveyDetail } from '../../src/client/admin/SurveyDetail'
import { SurveyList } from '../../src/client/admin/SurveyList'

const draft: SurveyDraftInput = {
  title: '설문',
  description: '',
  resultsVisibility: 'after_close',
  sections: [{ questions: [
    {
      type: 'single',
      title: '첫 문항',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [{ label: 'A', isOther: false }],
    },
  ] }],
}

describe('SurveyEditor', () => {
  it('제목을 고치면 알린다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('설문 제목'), '!')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: '설문!' }))
  })

  it('결과 공개 설정을 고를 수 있다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.selectOptions(screen.getByLabelText('결과 공개'), 'after_close')
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ resultsVisibility: 'after_close' }),
    )
  })

  it('문항을 추가한다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '섹션 1에 문항 추가' }))
    expect(onChange.mock.calls[0][0].sections[0].questions).toHaveLength(2)
  })

  it('문항을 지운다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '1번 문항 삭제' }))
    expect(onChange.mock.calls[0][0].sections[0].questions).toHaveLength(0)
  })

  it('필수 여부를 토글한다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('필수 응답'))
    expect(onChange.mock.calls[0][0].sections[0].questions[0].required).toBe(true)
  })

  it('다중선택일 때만 개수 제한 입력이 나온다', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<SurveyEditor draft={draft} onChange={onChange} />)
    expect(screen.queryByLabelText('최소 선택')).not.toBeInTheDocument()

    const multiDraft = {
      ...draft,
      sections: [{ questions: [{ ...draft.sections[0].questions[0], type: 'multi' as const }] }],
    }
    rerender(<SurveyEditor draft={multiDraft} onChange={onChange} />)
    expect(screen.getByLabelText('최소 선택')).toBeInTheDocument()
  })

  it('개수 제한 칸에 숫자가 아닌 글자를 넣어도 NaN 이 남지 않는다', async () => {
    const onChange = vi.fn()
    const multiDraft: SurveyDraftInput = {
      ...draft,
      sections: [{ questions: [{ ...draft.sections[0].questions[0], type: 'multi' as const }] }],
    }
    render(<SurveyEditor draft={multiDraft} onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('최소 선택'), '가')
    expect(onChange.mock.calls.at(-1)![0].sections[0].questions[0].minSelect).toBeNull()

    onChange.mockClear()
    await userEvent.type(screen.getByLabelText('최대 선택'), '3')
    expect(onChange.mock.calls.at(-1)![0].sections[0].questions[0].maxSelect).toBe(3)
  })

  it('보기를 추가한다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '1번 문항에 보기 추가' }))
    expect(onChange.mock.calls[0][0].sections[0].questions[0].options).toHaveLength(2)
  })

  it('기타 직접 입력 허용을 끄면 보기별 기타 표시도 함께 지운다', async () => {
    const onChange = vi.fn()
    const draftWithOther: SurveyDraftInput = {
      ...draft,
      sections: [{ questions: [
        {
          ...draft.sections[0].questions[0],
          allowOther: true,
          options: [
            { label: 'A', isOther: false },
            { label: '기타', isOther: true },
          ],
        },
      ] }],
    }
    render(<SurveyEditor draft={draftWithOther} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('기타 직접 입력 허용'))

    const patched = onChange.mock.calls[0][0].sections[0].questions[0]
    expect(patched.allowOther).toBe(false)
    expect(patched.options.every((o: { isOther: boolean }) => o.isOther === false)).toBe(true)
  })

  it('기타 미허용 문항에서 보기를 기타로 표시하면 허용을 함께 켠다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('이 보기를 기타로 사용'))

    const patched = onChange.mock.calls[0][0].sections[0].questions[0]
    expect(patched.allowOther).toBe(true)
    expect(patched.options[0].isOther).toBe(true)
  })
})

describe('SurveyEditor 섹션', () => {
  const twoSections: SurveyDraftInput = {
    ...draft,
    sections: [
      { questions: [{ ...draft.sections[0].questions[0], title: '1번' }] },
      { questions: [{ ...draft.sections[0].questions[0], title: '2번' }] },
    ],
  }

  it('섹션을 추가한다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '섹션 추가' }))

    const patched = onChange.mock.calls[0][0]
    expect(patched.sections).toHaveLength(2)
    expect(patched.sections[1].questions).toEqual([])
  })

  it('마지막 섹션은 지우지 못한다 — 문항을 넣을 자리가 없어진다', async () => {
    render(<SurveyEditor draft={draft} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '섹션 1 삭제' })).toBeDisabled()
  })

  it('섹션을 지우면 그 안의 문항도 함께 사라진다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoSections} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '섹션 1 삭제' }))

    const patched = onChange.mock.calls[0][0]
    expect(patched.sections).toHaveLength(1)
    expect(patched.sections[0].questions[0].title).toBe('2번')
  })

  it('섹션 순서를 바꾼다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoSections} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '섹션 2 위로 이동' }))

    const patched = onChange.mock.calls[0][0]
    expect(patched.sections.map((s: { questions: { title: string }[] }) => s.questions[0].title))
      .toEqual(['2번', '1번'])
  })

  it('문항 번호는 섹션을 넘어 이어서 센다', async () => {
    render(<SurveyEditor draft={twoSections} onChange={vi.fn()} />)

    expect(screen.getByText(/1번 문항/)).toBeInTheDocument()
    expect(screen.getByText(/2번 문항/)).toBeInTheDocument()
  })

  it('섹션의 첫 문항에서 「위로」를 누르면 앞 섹션의 끝으로 건너간다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoSections} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '2번 문항 위로 이동' }))

    const patched = onChange.mock.calls[0][0]
    expect(patched.sections[0].questions.map((q: { title: string }) => q.title)).toEqual([
      '1번',
      '2번',
    ])
    expect(patched.sections[1].questions).toEqual([])
  })

  it('섹션의 마지막 문항에서 「아래로」를 누르면 다음 섹션의 앞으로 건너간다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoSections} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '1번 문항 아래로 이동' }))

    const patched = onChange.mock.calls[0][0]
    expect(patched.sections[0].questions).toEqual([])
    expect(patched.sections[1].questions.map((q: { title: string }) => q.title)).toEqual([
      '1번',
      '2번',
    ])
  })

  it('설문 전체의 첫 문항과 마지막 문항은 더 갈 곳이 없다', async () => {
    render(<SurveyEditor draft={twoSections} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '1번 문항 위로 이동' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '2번 문항 아래로 이동' })).toBeDisabled()
  })

  it('문항은 그 섹션에만 더한다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoSections} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '섹션 2에 문항 추가' }))

    const patched = onChange.mock.calls[0][0]
    expect(patched.sections[0].questions).toHaveLength(1)
    expect(patched.sections[1].questions).toHaveLength(2)
  })
})

describe('AuditView', () => {
  const report = {
    participants: [
      {
        id: 'p1',
        name: '홍길동',
        studentId: '20250001',
        submittedAt: Date.UTC(2026, 8, 2, 1, 0),
        ipHash: 'ip-a',
        uaHash: 'ua-a',
      },
    ],
    duplicateIdentities: [
      {
        name: '홍길동',
        studentId: '20250001',
        count: 2,
        submittedAts: [1, 2],
        ipHashes: ['ip-a', 'ip-b'],
      },
    ],
    duplicateDevices: [{ browserKeyHash: 'abcdef0123456789', count: 2 }],
    sharedNetworks: [{ ipHash: 'ip-a', count: 3 }],
    integrity: { participantCount: 1, submissionCount: 1, consistent: true },
  }

  // 명부는 「참가자」 탭으로 옮겼다(test/client/participants.test.tsx) —
  // 점검은 이상 징후만 다룬다.
  it('명부를 싣지 않는다', () => {
    render(<AuditView report={report} />)
    expect(screen.queryByText('제출 시각(KST)')).not.toBeInTheDocument()
  })

  it('신원 중복을 눈에 띄게 알린다', () => {
    render(<AuditView report={report} />)
    expect(screen.getByText(/신원 중복 1건/)).toBeInTheDocument()
  })

  it('기기 중복과 동일 네트워크를 보여준다', () => {
    render(<AuditView report={report} />)
    expect(screen.getByText(/기기 중복 1건/)).toBeInTheDocument()
    expect(screen.getByText(/동일 네트워크 1건/)).toBeInTheDocument()
  })

  it('정합성이 어긋나면 경보를 띄운다', () => {
    render(
      <AuditView
        report={{
          ...report,
          integrity: { participantCount: 2, submissionCount: 1, consistent: false },
        }}
      />,
    )
    expect(screen.getByText(/정합성 경보/)).toBeInTheDocument()
  })

  it('0건 항목은 물러나고, 실제 발견은 그렇지 않다는 것을 마크로 구분한다', () => {
    // 신원 중복만 실제로 있고(1건) 기기 중복·동일 네트워크는 0건인 섞인
    // 상태 — 0건이 실제 발견과 똑같이 굵게 소리치던 버그(2026-09-03)의
    // 회귀 테스트. 색·배지·아이콘이 아니라 굵기·불투명도로만 갈리므로,
    // 그 구분이 실제로 걸렸는지는 클래스로 확인한다.
    render(
      <AuditView
        report={{
          ...report,
          duplicateDevices: [],
          sharedNetworks: [],
        }}
      />,
    )

    const identityHeadline = screen.getByText(/신원 중복 1건/)
    const deviceHeadline = screen.getByText(/기기 중복 0건/)
    const networkHeadline = screen.getByText(/동일 네트워크 0건/)

    expect(identityHeadline).not.toHaveClass('audit-section__headline--zero')
    expect(deviceHeadline).toHaveClass('audit-section__headline--zero')
    expect(networkHeadline).toHaveClass('audit-section__headline--zero')
  })

  it('이상 징후가 하나도 없으면 안심할 수 있는 문구를 보여준다', () => {
    render(
      <AuditView
        report={{
          participants: [],
          duplicateIdentities: [],
          duplicateDevices: [],
          sharedNetworks: [],
          integrity: { participantCount: 0, submissionCount: 0, consistent: true },
        }}
      />,
    )
    expect(screen.getByText('이상이 없어요.')).toBeInTheDocument()
    expect(screen.queryByText(/신원 중복 0건/)).not.toBeInTheDocument()
  })
})

describe('SurveyEditor 보기 편집', () => {
  const twoOptionDraft: SurveyDraftInput = {
    title: '설문',
    description: '',
    resultsVisibility: 'after_close',
    sections: [{ questions: [
      {
        type: 'single',
        title: '첫 문항',
        description: '',
        required: false,
        minSelect: null,
        maxSelect: null,
        allowOther: false,
        options: [
          { label: 'A', isOther: false },
          { label: 'B', isOther: false },
        ],
      },
    ] }],
  }

  it('보기를 지운다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoOptionDraft} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '1번 문항 보기 2 삭제' }))
    const patched = onChange.mock.calls[0][0].sections[0].questions[0].options
    expect(patched).toHaveLength(1)
    expect(patched[0].label).toBe('A')
  })

  it('보기가 하나뿐이면 삭제 버튼이 비활성화된다', () => {
    render(<SurveyEditor draft={draft} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '1번 문항 보기 1 삭제' })).toBeDisabled()
  })

  it('보기 순서를 바꾼다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoOptionDraft} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '1번 문항 보기 2 위로 이동' }))
    const patched = onChange.mock.calls[0][0].sections[0].questions[0].options
    expect(patched.map((o: { label: string }) => o.label)).toEqual(['B', 'A'])
  })

  it('첫 보기의 위로 버튼과 마지막 보기의 아래로 버튼은 비활성화된다', () => {
    render(<SurveyEditor draft={twoOptionDraft} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '1번 문항 보기 1 위로 이동' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1번 문항 보기 2 아래로 이동' })).toBeDisabled()
  })

  // §I3 — 배열 인덱스를 key 로 쓰면 재정렬 뒤에도 같은 자리의 DOM 노드가
  // 그대로 남는다. 같은 버튼 참조를 재조회 없이 두 번 누르면, 인덱스
  // 기반이었을 때는 "그 자리를 위로" 두 번 눌러 첫 이동과 되돌림이 되어
  // 결국 원래 순서로 돌아간다(핑퐁). 안정된 id 기반 key 라면 매번 실제로
  // 그 보기를 따라가 두 칸 움직인다.
  it('같은 위로 버튼을 재조회 없이 두 번 누르면 같은 보기가 두 칸 움직인다', async () => {
    const threeOptionDraft: SurveyDraftInput = {
      title: '설문',
      description: '',
      resultsVisibility: 'after_close',
      sections: [{ questions: [
        {
          type: 'single',
          title: '첫 문항',
          description: '',
          required: false,
          minSelect: null,
          maxSelect: null,
          allowOther: false,
          options: [
            { label: 'A', isOther: false },
            { label: 'B', isOther: false },
            { label: 'C', isOther: false },
          ],
        },
      ] }],
    }

    function Controlled() {
      const [d, setD] = useState(threeOptionDraft)
      return <SurveyEditor draft={d} onChange={setD} />
    }

    render(<Controlled />)

    const upButton = screen.getByRole('button', { name: '1번 문항 보기 3 위로 이동' })
    await userEvent.click(upButton)
    await userEvent.click(upButton)

    const labels = screen
      .getAllByDisplayValue(/^[ABC]$/)
      .map((el) => (el as HTMLInputElement).value)
    // C 가 두 칸 위로 — [C, A, B]. 핑퐁이었다면 [A, B, C] 그대로였을 것이다.
    expect(labels).toEqual(['C', 'A', 'B'])
  })
})

describe('SurveyEditor 잠금', () => {
  it('잠기면 문항 관련 입력이 모두 비활성화된다', () => {
    render(<SurveyEditor draft={draft} onChange={vi.fn()} locked />)
    expect(screen.getByLabelText('설문 제목')).toBeDisabled()
    expect(screen.getByLabelText('필수 응답')).toBeDisabled()
    expect(screen.getByRole('button', { name: '섹션 1에 문항 추가' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1번 문항 삭제' })).toBeDisabled()
  })

  it('잠겨도 결과 공개 설정은 그대로 바꿀 수 있다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={draft} onChange={onChange} locked />)

    expect(screen.getByLabelText('결과 공개')).toBeEnabled()
    await userEvent.selectOptions(screen.getByLabelText('결과 공개'), 'after_close')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ resultsVisibility: 'after_close' }))
  })
})

describe('SurveyList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(surveys: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(surveys), { status: 200 })),
    )
  }

  it('만든 설문이 없으면 첫 설문을 만들라는 안내를 보여준다', async () => {
    mockFetch([])
    render(
      <MemoryRouter>
        <SurveyList />
      </MemoryRouter>,
    )

    expect(await screen.findByText('아직 만든 설문이 없어요')).toBeInTheDocument()
  })

  it('설문이 있으면 목록과 상태를 보여준다', async () => {
    mockFetch([
      { id: 's1', title: '동아리 회장 선거', status: 'open', resultsVisibility: 'after_close', participantCount: 5 },
    ])
    render(
      <MemoryRouter>
        <SurveyList />
      </MemoryRouter>,
    )

    expect(await screen.findByText('동아리 회장 선거')).toBeInTheDocument()
    expect(screen.getByText('진행 중')).toBeInTheDocument()
    expect(screen.getByText('참여 5명')).toBeInTheDocument()
    expect(screen.queryByText('아직 만든 설문이 없어요')).not.toBeInTheDocument()
  })

  // 느린 망(PRODUCT.md)에서 두 번째 탭이 겹쳐 나가 설문이 두 개 생기지
  // 않으려면, 요청이 오가는 동안 버튼이 실제로 disabled 여야 한다(§fix 8).
  it('만드는 중에는 버튼이 비활성화되어 두 번째 탭으로 두 번 요청이 나가지 않는다', async () => {
    const deferredPost: { resolve: (() => void) | null } = { resolve: null }
    let postCount = 0
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1
        return new Promise<Response>((resolve) => {
          deferredPost.resolve = () =>
            resolve(new Response(JSON.stringify({ id: 'new1' }), { status: 200 }))
        })
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter>
        <SurveyList />
      </MemoryRouter>,
    )
    await screen.findByText('아직 만든 설문이 없어요')

    const button = screen.getByRole('button', { name: '새 설문 만들기' })
    await userEvent.click(button)

    expect(screen.getByRole('button', { name: '만드는 중…' })).toBeDisabled()

    // 아직 응답이 오지 않은 사이에 한 번 더 눌러 본다 — 버튼이 실제로
    // disabled 라면 두 번째 클릭은 아무 일도 하지 않는다.
    await userEvent.click(screen.getByRole('button', { name: '만드는 중…' }))
    expect(postCount).toBe(1)

    deferredPost.resolve?.()
    await waitFor(() => expect(screen.getByRole('button', { name: '새 설문 만들기' })).toBeEnabled())
  })
})

describe('SurveyDetail — 저장/설문 열기/마감/복제 진행 중 상태 (§fix 8)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const draftSurvey: SurveyDef = {
    id: 's1',
    title: '설문',
    description: '',
    status: 'draft',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections: [{ id: 'sec1', questions: [] }],
  }

  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={['/admin/surveys/s1']}>
        <Routes>
          <Route path="/admin/surveys/:surveyId" element={<SurveyDetail />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('설문 열기 요청이 오가는 동안 그 버튼과 다른 액션 버튼 모두 비활성화된다', async () => {
    const deferredPost: { resolve: (() => void) | null } = { resolve: null }
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          deferredPost.resolve = () =>
            resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        })
      }
      return Promise.resolve(
        new Response(JSON.stringify(draftSurvey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDetail()
    await screen.findByRole('button', { name: '설문 열기' })

    await userEvent.click(screen.getByRole('button', { name: '설문 열기' }))

    const openButton = screen.getByRole('button', { name: '여는 중…' })
    expect(openButton).toBeDisabled()
    // 같은 화면의 다른 액션 버튼(복제)도 함께 잠긴다 — 응답을 기다리는
    // 동안 다른 요청이 겹쳐 나가지 않게 한다.
    expect(screen.getByRole('button', { name: '설문 복제' })).toBeDisabled()

    deferredPost.resolve?.()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '설문 열기' })).toBeEnabled(),
    )
  })

  it('저장 요청이 오가는 동안 저장 버튼이 비활성화되고 라벨이 바뀐다', async () => {
    const deferredPut: { resolve: (() => void) | null } = { resolve: null }
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Promise<Response>((resolve) => {
          deferredPut.resolve = () =>
            resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        })
      }
      return Promise.resolve(
        new Response(JSON.stringify(draftSurvey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDetail()
    await screen.findByRole('button', { name: '저장' })

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('button', { name: '저장하는 중…' })).toBeDisabled()

    deferredPut.resolve?.()
    await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).toBeEnabled())
  })
})

describe('SurveyDetail — 상태 표시·탭 전환·편집 잠금', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const openSurvey: SurveyDef = {
    id: 's1',
    title: '설문',
    description: '',
    status: 'open',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections: [{ id: 'sec1', questions: [
      {
        id: 'q1',
        type: 'single',
        title: '첫 문항',
        description: '',
        required: false,
        minSelect: null,
        maxSelect: null,
        allowOther: false,
        options: [{ id: 'o1', label: 'A', isOther: false }],
        rules: [],
      },
    ] }],
  }

  function mockFetchFor(survey: SurveyDef) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/results')) {
          return new Response(JSON.stringify({ submissionCount: 0, results: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('/allowlist')) {
          return new Response(JSON.stringify({ entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('/roster')) {
          return new Response(
            JSON.stringify({
              enabled: false,
              participated: [],
              notParticipated: [],
              unlisted: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.endsWith('/audit')) {
          return new Response(
            JSON.stringify({
              participants: [],
              duplicateIdentities: [],
              duplicateDevices: [],
              sharedNetworks: [],
              integrity: { participantCount: 0, submissionCount: 0, consistent: true },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify(survey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
  }

  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={['/admin/surveys/s1']}>
        <Routes>
          <Route path="/admin/surveys/:surveyId" element={<SurveyDetail />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('설문 상태 이름과 투표 링크를 보여준다', async () => {
    mockFetchFor(openSurvey)
    renderDetail()

    expect(await screen.findByText('진행 중')).toBeInTheDocument()
    expect(screen.getByText('/s/s1')).toBeInTheDocument()
  })

  it('탭을 누르면 그 탭의 내용으로 바뀐다', async () => {
    mockFetchFor(openSurvey)
    renderDetail()
    await screen.findByRole('tab', { name: '편집' })

    expect(screen.getByRole('tab', { name: '편집' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '결과' })).toHaveAttribute('aria-selected', 'false')

    await userEvent.click(screen.getByRole('tab', { name: '결과' }))

    expect(screen.getByRole('tab', { name: '결과' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '편집' })).toHaveAttribute('aria-selected', 'false')
    // 진행 중인 설문이라 집계 대신 잠금 안내가 선다(§requireClosedForResults).
    expect(await screen.findByText(/마감한 뒤에 결과를 볼 수 있어요/)).toBeInTheDocument()
    expect(screen.queryByLabelText('설문 제목')).not.toBeInTheDocument()
  })

  // 마감 전에 집계를 두 번 읽으면 그 차이가 그 사이 들어온 한 표다. 참가자
  // 화면이 그 표에 이름을 붙이므로 관리자에게도 주지 않는다.
  it('마감 전 결과 탭은 집계를 묻지도 않는다', async () => {
    mockFetchFor(openSurvey)
    renderDetail()
    await screen.findByRole('tab', { name: '편집' })

    await userEvent.click(screen.getByRole('tab', { name: '결과' }))
    await screen.findByText(/마감한 뒤에 결과를 볼 수 있어요/)

    const asked = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
      (call) => String(call[0]).endsWith('/results'),
    )
    expect(asked).toBe(false)
  })

  it('마감한 설문의 결과 탭은 집계를 보여준다', async () => {
    mockFetchFor({ ...openSurvey, status: 'closed' })
    renderDetail()
    await screen.findByRole('tab', { name: '편집' })

    await userEvent.click(screen.getByRole('tab', { name: '결과' }))

    expect(await screen.findByText('아직 들어온 응답이 없어요.')).toBeInTheDocument()
  })

  it('화살표 키로 탭 사이를 옮겨 다닌다 (롤빙 tabindex)', async () => {
    mockFetchFor(openSurvey)
    renderDetail()
    const editTab = await screen.findByRole('tab', { name: '편집' })
    const resultsTab = screen.getByRole('tab', { name: '결과' })
    const participantsTab = screen.getByRole('tab', { name: '참가자' })
    const allowlistTab = screen.getByRole('tab', { name: '응답 허용 설정' })
    const auditTab = screen.getByRole('tab', { name: '점검' })

    // 활성 탭만 탭 키 정지점이다 — 나머지는 -1.
    expect(editTab).toHaveAttribute('tabindex', '0')
    expect(resultsTab).toHaveAttribute('tabindex', '-1')
    expect(auditTab).toHaveAttribute('tabindex', '-1')

    editTab.focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(resultsTab).toHaveFocus()
    expect(resultsTab).toHaveAttribute('aria-selected', 'true')
    expect(resultsTab).toHaveAttribute('tabindex', '0')
    expect(editTab).toHaveAttribute('tabindex', '-1')

    // 마지막 탭에서 오른쪽으로 가면 처음으로 돌아온다.
    await userEvent.keyboard('{ArrowRight}')
    expect(participantsTab).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(allowlistTab).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(auditTab).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(editTab).toHaveFocus()
    expect(editTab).toHaveAttribute('aria-selected', 'true')
  })

  it('draft 가 아닌 설문은 편집 탭에서 문항 입력이 잠긴다', async () => {
    mockFetchFor(openSurvey)
    renderDetail()
    await screen.findByRole('tab', { name: '편집' })

    // draft 가 아니므로 잠금 안내와 함께 문항 입력이 비활성화된다.
    expect(screen.getByText(/문항을 바꿀 수 없어요/)).toBeInTheDocument()
    expect(screen.getByLabelText('설문 제목')).toBeDisabled()
    expect(screen.getByLabelText('필수 응답')).toBeDisabled()
    // 결과 공개 설정만은 마감 후에도 바꿀 수 있어야 하므로 잠기지 않는다.
    expect(screen.getByLabelText('결과 공개')).toBeEnabled()
  })

  it('draft 설문은 편집 탭에서 문항 입력이 잠기지 않는다', async () => {
    const draftDetailSurvey: SurveyDef = { ...openSurvey, status: 'draft' }
    mockFetchFor(draftDetailSurvey)
    renderDetail()
    await screen.findByRole('tab', { name: '편집' })

    expect(screen.queryByText(/문항을 바꿀 수 없어요/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('설문 제목')).toBeEnabled()
  })

  // 마감은 종착이 아니다 — 잘못 마감했거나 아직 안 낸 사람이 남았을 때
  // 다시 열 수 있어야 한다.
  it('마감한 설문에만 「다시 열기」가 뜨고, 누르면 재개 요청을 보낸다', async () => {
    const closedSurvey: SurveyDef = { ...openSurvey, status: 'closed' }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init
      return new Response(JSON.stringify(url.endsWith('/reopen') ? { ok: true } : closedSurvey), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: '다시 열기' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/admin/surveys/s1/reopen' && init?.method === 'POST',
        ),
      ).toBe(true),
    )
  })

  it('진행 중·작성 중 설문에는 「다시 열기」가 없다', async () => {
    mockFetchFor(openSurvey)
    const { unmount } = renderDetail()
    await screen.findByRole('tab', { name: '편집' })
    expect(screen.queryByRole('button', { name: '다시 열기' })).not.toBeInTheDocument()
    unmount()

    mockFetchFor({ ...openSurvey, status: 'draft' })
    renderDetail()
    await screen.findByRole('tab', { name: '편집' })
    expect(screen.queryByRole('button', { name: '다시 열기' })).not.toBeInTheDocument()
  })

  // 재개하면 isResultsPublic 이 after_close 를 다시 거짓으로 돌린다 —
  // 공개돼 있던 결과가 도로 가려진다. 누르기 전에 그 사실을 말해 준다.
  it('결과 공개가 「마감 후」인 마감 설문에는 재개하면 결과가 다시 가려진다고 알린다', async () => {
    mockFetchFor({ ...openSurvey, status: 'closed', resultsVisibility: 'after_close' })
    renderDetail()
    await screen.findByRole('button', { name: '다시 열기' })

    expect(screen.getByText(/결과가 다시 가려져요/)).toBeInTheDocument()
  })

  it('결과 공개가 「마감 후 관리자만」이면 그 경고를 띄우지 않는다', async () => {
    mockFetchFor({ ...openSurvey, status: 'closed', resultsVisibility: 'admin' })
    renderDetail()
    await screen.findByRole('button', { name: '다시 열기' })

    expect(screen.queryByText(/결과가 다시 가려져요/)).not.toBeInTheDocument()
  })
})

describe('SurveyDetail — 예약 마감과 삭제', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const base: SurveyDef = {
    id: 's1',
    title: '설문',
    description: '',
    status: 'open',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections: [{ id: 'sec1', questions: [] }],
  }

  const calls: Array<{ url: string; method: string; body: unknown }> = []

  function mockDetail(survey: SurveyDef) {
    calls.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method) {
          calls.push({
            url,
            method: init.method,
            body: init.body ? JSON.parse(String(init.body)) : null,
          })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response(JSON.stringify(survey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
  }

  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={['/admin/surveys/s1']}>
        <Routes>
          <Route path="/admin/surveys/:surveyId" element={<SurveyDetail />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('적은 시각을 밀리초로 보낸다', async () => {
    mockDetail(base)
    renderDetail()
    await screen.findByLabelText('예약 마감 (KST)')

    const input = screen.getByLabelText('예약 마감 (KST)')
    fireEvent.change(input, { target: { value: '2026-09-10T18:00' } })
    await userEvent.click(screen.getByRole('button', { name: '예약 저장' }))

    const sent = calls.find((c) => c.url.endsWith('/schedule'))!
    expect(sent.method).toBe('POST')
    // 브라우저의 시간대로 읽은 그 시각이다 — 시험이 도는 시간대에 기대지
    // 않도록 같은 문자열을 같은 방식으로 되돌려 비교한다.
    // 입력칸은 KST 로 읽는다 — 시험 기기의 시간대와 무관하다.
    expect(sent.body).toEqual({ closeAt: Date.parse('2026-09-10T18:00+09:00') })
  })

  it('예약이 걸린 설문은 언제 마감되는지 말해 준다', async () => {
    const closeAt = Date.parse('2026-09-10T18:00+09:00')
    mockDetail({ ...base, closeAt })
    renderDetail()

    expect(await screen.findByText(/에 마감돼요\./)).toBeInTheDocument()
    expect(screen.getByLabelText('예약 마감 (KST)')).toHaveValue('2026-09-10T18:00')
  })

  it('예약 해제는 null 을 보낸다', async () => {
    mockDetail({ ...base, closeAt: Date.parse('2026-09-10T18:00+09:00') })
    renderDetail()
    await screen.findByRole('button', { name: '예약 해제' })

    await userEvent.click(screen.getByRole('button', { name: '예약 해제' }))

    expect(calls.find((c) => c.url.endsWith('/schedule'))!.body).toEqual({ closeAt: null })
  })

  it('마감된 설문에는 예약을 걸 수 없다', async () => {
    mockDetail({ ...base, status: 'closed' })
    renderDetail()
    await screen.findByLabelText('예약 마감 (KST)')

    expect(screen.getByLabelText('예약 마감 (KST)')).toBeDisabled()
    expect(screen.getByRole('button', { name: '예약 저장' })).toBeDisabled()
  })

  it('삭제는 두 단계다 — 첫 누름은 무엇이 사라지는지 말할 뿐이다', async () => {
    mockDetail(base)
    renderDetail()
    await screen.findByRole('button', { name: '설문 삭제' })

    await userEvent.click(screen.getByRole('button', { name: '설문 삭제' }))

    expect(screen.getByText(/되돌릴 수 없어요/)).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: '정말 삭제' }))
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })

  it('확인 화면에서 취소하면 아무 일도 없다', async () => {
    mockDetail(base)
    renderDetail()
    await screen.findByRole('button', { name: '설문 삭제' })

    await userEvent.click(screen.getByRole('button', { name: '설문 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(screen.getByRole('button', { name: '설문 삭제' })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
  })
})

describe('SurveyDetail — 명단 탭', () => {
  const openSurvey: SurveyDef = {
    id: 's1',
    title: '설문',
    description: '',
    status: 'open',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections: [{ id: 'sec1', questions: [] }],
  }

  let putBody: unknown = null

  function mockRoster(
    options: { entries?: unknown[]; roster?: unknown; participants?: unknown[] } = {},
  ) {
    putBody = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT' && url.endsWith('/allowlist')) {
          putBody = JSON.parse(String(init.body))
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('/allowlist')) {
          return new Response(JSON.stringify({ entries: options.entries ?? [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('/audit')) {
          return new Response(
            JSON.stringify({
              participants: options.participants ?? [],
              duplicateIdentities: [],
              duplicateDevices: [],
              sharedNetworks: [],
              integrity: { participantCount: 0, submissionCount: 0, consistent: true },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.endsWith('/roster')) {
          return new Response(
            JSON.stringify(
              options.roster ?? {
                enabled: true,
                participated: [{ name: '홍길동', studentId: '20250001' }],
                notParticipated: [{ name: '김서연', studentId: '20250002' }],
                unlisted: [],
              },
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify(openSurvey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
  }

  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={['/admin/surveys/s1']}>
        <Routes>
          <Route path="/admin/surveys/:surveyId" element={<SurveyDetail />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('응답 허용 설정 탭과 참가자 탭이 따로 있다', async () => {
    mockRoster()
    renderDetail()
    expect(await screen.findByRole('tab', { name: '응답 허용 설정' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '참가자' })).toBeInTheDocument()
  })

  // 명단·현황은 이 탭을 열기 전에는 필요 없다. 상세 화면을 열 때마다
  // 미리 받아 오면 관리자가 쓰지도 않을 요청이 매번 두 번씩 나간다.
  it('탭을 열어야 명단을 받아 온다', async () => {
    mockRoster({ entries: [{ name: '김서연', studentId: '20250002' }] })
    renderDetail()
    await screen.findByRole('tab', { name: '응답 허용 설정' })

    await userEvent.click(screen.getByRole('tab', { name: '응답 허용 설정' }))

    expect(await screen.findByLabelText('허용 명단')).toHaveValue('김서연,20250002')
  })

  // 참가 현황은 이제 참가자 탭이 맡는다 — 명단 화면에는 설정만 남는다.
  it('참가자 탭이 미참가자를 보여준다', async () => {
    mockRoster()
    renderDetail()
    await screen.findByRole('tab', { name: '참가자' })

    await userEvent.click(screen.getByRole('tab', { name: '참가자' }))

    expect(await screen.findByText(/아직 안 낸 사람 1명/)).toBeInTheDocument()
    expect(screen.getByText('김서연')).toBeInTheDocument()
  })

  it('응답 허용 설정 탭에는 참가 현황을 싣지 않는다', async () => {
    mockRoster()
    renderDetail()
    await screen.findByRole('tab', { name: '응답 허용 설정' })

    await userEvent.click(screen.getByRole('tab', { name: '응답 허용 설정' }))
    await screen.findByLabelText('허용 명단')

    expect(screen.queryByText(/아직 안 낸 사람/)).not.toBeInTheDocument()
  })

  it('저장한 명단을 서버로 보낸다', async () => {
    mockRoster()
    renderDetail()
    await screen.findByRole('tab', { name: '응답 허용 설정' })
    await userEvent.click(screen.getByRole('tab', { name: '응답 허용 설정' }))
    await screen.findByLabelText('허용 명단')

    await userEvent.type(screen.getByLabelText('허용 명단'), '박도현,20250003')
    await userEvent.click(screen.getByRole('button', { name: '명단 저장' }))

    await waitFor(() => expect(putBody).not.toBeNull())
    expect(putBody).toEqual({ entries: [{ name: '박도현', studentId: '20250003' }] })
  })

  // 저장한 뒤 현황이 그대로면 방금 넣은 사람이 미참가 목록에 나타나지
  // 않는다 — 관리자는 저장이 안 된 줄 알고 한 번 더 누른다.
  it('저장한 뒤 현황을 다시 받아 온다', async () => {
    mockRoster()
    renderDetail()
    await screen.findByRole('tab', { name: '응답 허용 설정' })
    await userEvent.click(screen.getByRole('tab', { name: '응답 허용 설정' }))
    await screen.findByLabelText('허용 명단')

    mockRoster({
      entries: [{ name: '박도현', studentId: '20250003' }],
      roster: {
        enabled: true,
        participated: [],
        notParticipated: [{ name: '박도현', studentId: '20250003' }],
        unlisted: [],
      },
    })

    await userEvent.type(screen.getByLabelText('허용 명단'), '박도현,20250003')
    await userEvent.click(screen.getByRole('button', { name: '명단 저장' }))

    // 현황은 참가자 탭이 보여준다. 저장 직후 그 탭이 옛 명단으로 계산된
    // 현황을 들고 있으면, 방금 넣은 사람이 미참가 목록에 없다.
    await waitFor(() => expect(putBody).not.toBeNull())
    await userEvent.click(screen.getByRole('tab', { name: '참가자' }))

    expect(await screen.findByText('박도현')).toBeInTheDocument()
  })
})

describe('SurveyEditor 조건 규칙', () => {
  function twoQuestionDraft(): SurveyDraftInput {
    return {
      title: '설문',
      description: '',
      resultsVisibility: 'after_close',
      sections: [
        {
          questions: [
            {
              type: 'single',
              title: '수강합니까?',
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
            },
            {
              type: 'single',
              title: '찬성합니까?',
              description: '',
              required: false,
              minSelect: null,
              maxSelect: null,
              allowOther: false,
              options: [{ label: '찬성', isOther: false }],
              rules: [],
            },
          ],
        },
      ],
    }
  }

  function ruleOnFirst(draft: SurveyDraftInput) {
    draft.sections[0].questions[0].rules = [
  {
        match: 'all',
        action: 'show',
        targets: [{ kind: 'question', questionIndex: 1 }],
        conditions: [{ operator: 'is', optionIndex: 0 }],
  }
    ]
    return draft
  }

  it('조건 추가를 누르면 규칙이 생기고 첫 조건이 채워진다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoQuestionDraft()} onChange={onChange} />)

    await userEvent.click(screen.getAllByRole('button', { name: '조건 추가' })[0])

    const next = onChange.mock.calls.at(-1)![0]
    const rule = next.sections[0].questions[0].rules[0]
    expect(rule).toBeDefined()
    expect(rule.conditions).toHaveLength(1)
    expect(rule.match).toBe('all')
    expect(rule.action).toBe('show')
  })

  it('조건 추가를 다시 누르면 규칙이 하나 더 붙는다', async () => {
    const start = twoQuestionDraft()
    start.sections[0].questions.push({
      type: 'single' as const,
      title: '세 번째',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [{ label: 'A', isOther: false }],
      rules: [],
    })
    const onChange = vi.fn()
    render(<SurveyEditor draft={ruleOnFirst(start)} onChange={onChange} />)

    await userEvent.click(screen.getAllByRole('button', { name: '조건 추가' })[0])

    const next = onChange.mock.calls.at(-1)![0]
    const rules = next.sections[0].questions[0].rules
    expect(rules).toHaveLength(2)
    // 새 규칙의 대상은 이미 첫 규칙이 찜한 2번이 아니라 그 다음 자리다 —
    // 만들자마자 저장이 막히는 규칙을 내놓지 않는다.
    expect(rules[1].targets).toEqual([{ kind: 'question', questionIndex: 2 }])
  })

  it('문항 설명을 적으면 초안에 실린다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={twoQuestionDraft()} onChange={onChange} />)

    await userEvent.type(screen.getAllByLabelText('문항 설명')[0], '수강생만')

    const next = onChange.mock.calls.at(-1)![0]
    expect(next.sections[0].questions[0].description).not.toBe('')
  })

  it('대상 목록에 뒤 문항이 오르고 자기 자신은 오르지 않는다', () => {
    render(<SurveyEditor draft={ruleOnFirst(twoQuestionDraft())} onChange={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: '찬성합니까?' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: '수강합니까?' })).not.toBeInTheDocument()
  })

  it('대상을 하나 더 켜면 규칙이 둘을 함께 조종한다', async () => {
    const start = twoQuestionDraft()
    start.sections[0].questions.push({
      type: 'single' as const,
      title: '세 번째',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [{ label: 'A', isOther: false }],
      rules: [],
    })
    const onChange = vi.fn()
    render(<SurveyEditor draft={ruleOnFirst(start)} onChange={onChange} />)

    await userEvent.click(screen.getByRole('checkbox', { name: '세 번째' }))

    const next = onChange.mock.calls.at(-1)![0]
    expect(next.sections[0].questions[0].rules[0].targets).toEqual([
      { kind: 'question', questionIndex: 1 },
      { kind: 'question', questionIndex: 2 },
    ])
  })

  it('마지막 대상은 끄지 못한다 — 대상 없는 규칙은 아무것도 뜻하지 않는다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={ruleOnFirst(twoQuestionDraft())} onChange={onChange} />)

    await userEvent.click(screen.getByRole('checkbox', { name: '찬성합니까?' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: '찬성합니까?' })).toBeChecked()
  })

  it('다른 규칙이 이미 지목한 문항은 대상 목록에 오르지 않는다', () => {
    const draft = twoQuestionDraft()
    draft.sections[0].questions.push({
      type: 'single' as const,
      title: '세 번째',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [{ label: 'A', isOther: false }],
      rules: [],
    })
    // 2번 문항이 3번을 이미 조종한다.
    draft.sections[0].questions[1].rules = [
  {
        match: 'all',
        action: 'show',
        targets: [{ kind: 'question', questionIndex: 2 }],
        conditions: [{ operator: 'is', optionIndex: 0 }],
  }
    ]
    render(<SurveyEditor draft={ruleOnFirst(draft)} onChange={vi.fn()} />)

    // 1번 문항의 대상 목록에는 3번이 없다 — 3번 자리의 체크박스는 2번
    // 문항의 것 하나뿐이다.
    expect(screen.getAllByRole('checkbox', { name: '세 번째' })).toHaveLength(1)
  })

  it('소유 문항이 주관식이면 연산자 목록이 답변 여부만 남는다', async () => {
    const draft = twoQuestionDraft()
    draft.sections[0].questions[0].type = 'text'
    draft.sections[0].questions[0].options = []
    draft.sections[0].questions[0].rules = [
  {
        match: 'all',
        action: 'show',
        targets: [{ kind: 'question', questionIndex: 1 }],
        conditions: [{ operator: 'answered', optionIndex: null }],
  }
    ]
    render(<SurveyEditor draft={draft} onChange={vi.fn()} />)

    const operator = screen.getByLabelText('조건 1 연산자 1')
    expect(within(operator).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '답하면',
      '답하지 않으면',
    ])
  })

  it('잠기면 규칙 편집이 모두 비활성된다', () => {
    render(<SurveyEditor draft={ruleOnFirst(twoQuestionDraft())} onChange={vi.fn()} locked />)

    expect(screen.getByRole('checkbox', { name: '찬성합니까?' })).toBeDisabled()
    expect(screen.getByLabelText('조건 1 연산자 1')).toBeDisabled()
    expect(screen.getByLabelText('조건 1 동작')).toBeDisabled()
  })

  it('규칙이 있으면 익명성 주의 문구를 띄운다', () => {
    render(<SurveyEditor draft={ruleOnFirst(twoQuestionDraft())} onChange={vi.fn()} />)

    expect(screen.getByText(/해당자가 한두 명뿐이면/)).toBeInTheDocument()
  })

  it('대상 문항 카드에 무엇이 자기를 조종하는지 뜬다', () => {
    render(<SurveyEditor draft={ruleOnFirst(twoQuestionDraft())} onChange={vi.fn()} />)

    expect(screen.getByText('수강합니까? 조건이 맞을 때 보임')).toBeInTheDocument()
  })

  it('문항을 옮기면 규칙의 참조도 따라 옮겨진다', async () => {
    const start = twoQuestionDraft()
    start.sections[0].questions.push({
      type: 'single' as const,
      title: '세 번째',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [{ label: 'A', isOther: false }],
      rules: [],
    })
    // 0번이 1번을 연다.
    start.sections[0].questions[0].rules = [
  {
        match: 'all',
        action: 'show',
        targets: [{ kind: 'question', questionIndex: 1 }],
        conditions: [{ operator: 'is', optionIndex: 0 }],
  }
    ]

    // 두 번 누르려면 화면이 자기 상태를 들고 있어야 한다 — vi.fn() 만
    // 건네면 두 번째 클릭도 첫 초안 위에서 일어난다.
    const seen: SurveyDraftInput[] = []
    function Controlled() {
      const [d, setD] = useState(start)
      return (
        <SurveyEditor
          draft={d}
          onChange={(next) => {
            seen.push(next)
            setD(next)
          }}
        />
      )
    }
    render(<Controlled />)

    // 3번째 문항을 맨 위로 두 번 올린다 → 원래 0,1 은 1,2 로 밀린다.
    await userEvent.click(screen.getByRole('button', { name: '3번 문항 위로 이동' }))
    await userEvent.click(screen.getByRole('button', { name: '2번 문항 위로 이동' }))

    const next = seen.at(-1)!
    const moved = next.sections[0].questions.find((q) => q.title === '수강합니까?')!
    expect(moved.rules![0].targets).toEqual([{ kind: 'question', questionIndex: 2 }])
  })

  it('대상 문항을 지우면 가리킬 것이 없어져 규칙도 사라진다', async () => {
    const onChange = vi.fn()
    render(<SurveyEditor draft={ruleOnFirst(twoQuestionDraft())} onChange={onChange} />)

    // 대상인 2번 문항을 지운다 → 가리킬 것이 없으니 규칙이 사라진다.
    await userEvent.click(screen.getByRole('button', { name: '2번 문항 삭제' }))

    const next = onChange.mock.calls.at(-1)![0]
    expect(next.sections[0].questions[0].rules ?? []).toEqual([])
  })

  it('순서를 어긴 규칙이 남으면 경고를 띄운다', () => {
    const draft = twoQuestionDraft()
    // 0번이 자기 자신을 대상으로 삼는다 — 조건이 나오기 전에 이미 지나간 자리다.
    draft.sections[0].questions[0].rules = [
  {
        match: 'all',
        action: 'show',
        targets: [{ kind: 'question', questionIndex: 0 }],
        conditions: [{ operator: 'is', optionIndex: 0 }],
  }
    ]
    render(<SurveyEditor draft={draft} onChange={vi.fn()} />)

    expect(screen.getByText(/뒤에 오는 문항만 조종할 수 있어요/)).toBeInTheDocument()
  })
})

describe('SurveyDetail — 저장이 조건 규칙을 지우지 않는다', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 1번 문항의 답으로 2번 문항을 여는, 저장돼 있는 설문. */
  const ruledSurvey: SurveyDef = {
    id: 's1',
    title: '설문',
    description: '',
    status: 'draft',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections: [
      {
        id: 'sec1',
        questions: [
          {
            id: 'q1',
            type: 'single',
            title: '수강합니까?',
            description: '',
            required: false,
            minSelect: null,
            maxSelect: null,
            allowOther: false,
            options: [
              { id: 'q1-o1', label: '예', isOther: false },
              { id: 'q1-o2', label: '아니오', isOther: false },
            ],
            rules: [
              {
                match: 'all',
                action: 'show',
                targets: [{ kind: 'question', questionId: 'q2' }],
                conditions: [{ operator: 'is', optionId: 'q1-o1' }],
              },
            ],
          },
          {
            id: 'q2',
            type: 'single',
            title: '어느 분반인가요?',
            description: '',
            required: false,
            minSelect: null,
            maxSelect: null,
            allowOther: false,
            options: [{ id: 'q2-o1', label: 'A', isOther: false }],
            rules: [],
          },
        ],
      },
    ],
  }

  it('불러온 설문을 그대로 저장하면 규칙이 함께 나간다', async () => {
    const sent: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          sent.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response(JSON.stringify(ruledSurvey), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(
      <MemoryRouter initialEntries={['/admin/surveys/s1']}>
        <Routes>
          <Route path="/admin/surveys/:surveyId" element={<SurveyDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: '저장' })
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    const body = sent[0] as SurveyDraftInput
    expect(body.sections[0].questions[0].rules![0]).toEqual({
      match: 'all',
      action: 'show',
      targets: [{ kind: 'question', questionIndex: 1 }],
      conditions: [{ operator: 'is', optionIndex: 0 }],
    })
  })

  it('규칙이 깨진 설문에서는 저장 버튼이 잠긴다', async () => {
    // 자기 자신을 대상으로 삼는 규칙 — 조건이 대상보다 앞설 수 없으므로
    // checkRules 가 거부한다. 서버도 같은 함수로 400 을 돌려주므로, 화면이
    // 먼저 막는 것이 보내고 거부당하는 것보다 낫다.
    const brokenSurvey: SurveyDef = {
      ...ruledSurvey,
      sections: [
        {
          ...ruledSurvey.sections[0],
          questions: [
            {
              ...ruledSurvey.sections[0].questions[0],
              rules: [
                {
                  match: 'all',
                  action: 'show',
                  targets: [{ kind: 'question', questionId: 'q1' }],
                  conditions: [{ operator: 'is', optionId: 'q1-o1' }],
                },
              ],
            },
            ruledSurvey.sections[0].questions[1],
          ],
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(brokenSurvey), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    render(
      <MemoryRouter initialEntries={['/admin/surveys/s1']}>
        <Routes>
          <Route path="/admin/surveys/:surveyId" element={<SurveyDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: '저장' })).toBeDisabled()
    expect(screen.getByText(/뒤에 오는 문항만 조종할 수 있어요/)).toBeInTheDocument()
  })

  it('편집 화면이 그 규칙을 대상 문항 자리에 보여준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(ruledSurvey), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    render(
      <MemoryRouter initialEntries={['/admin/surveys/s1']}>
        <Routes>
          <Route path="/admin/surveys/:surveyId" element={<SurveyDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/조건이 맞을 때 보임/)).toBeInTheDocument()
  })
})
