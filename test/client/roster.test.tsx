import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RosterReport } from '../../src/server/db/allowlist'
import type { Identity } from '../../src/shared/identity'
import { RosterView } from '../../src/client/admin/RosterView'

const emptyRoster: RosterReport = {
  enabled: false,
  participated: [],
  notParticipated: [],
  unlisted: [],
}

function renderView(overrides: {
  entries?: Identity[]
  roster?: RosterReport
  saving?: boolean
  onSave?: (entries: Identity[]) => void
} = {}) {
  const onSave = overrides.onSave ?? vi.fn()
  render(
    <RosterView
      entries={overrides.entries ?? []}
      roster={overrides.roster ?? emptyRoster}
      saving={overrides.saving ?? false}
      onSave={onSave}
    />,
  )
  return onSave
}

describe('RosterView — 명단 편집', () => {
  it('저장된 명단을 편집할 수 있는 텍스트로 채워 둔다', () => {
    renderView({
      entries: [
        { name: '홍길동', studentId: '20250001' },
        { name: '김서연', studentId: '20250002' },
      ],
    })
    expect(screen.getByLabelText('허용 명단')).toHaveValue('홍길동,20250001\n김서연,20250002')
  })

  // 명단이 비었다는 것이 "아무도 못 들어온다"로 읽히면 관리자는 이 기능을
  // 켜 놓고도 아무도 못 들어올까 봐 겁을 낸다. 반대라고 먼저 말해 준다.
  it('명단이 비었으면 제한이 꺼졌다고 알린다', () => {
    renderView()
    expect(screen.getByText(/링크를 가진 누구나 참여할 수 있어요/)).toBeInTheDocument()
  })

  it('저장하면 읽어낸 명단을 넘겨준다', async () => {
    const onSave = renderView()
    await userEvent.type(screen.getByLabelText('허용 명단'), '홍길동,20250001')
    await userEvent.click(screen.getByRole('button', { name: '명단 저장' }))

    expect(onSave).toHaveBeenCalledWith([{ name: '홍길동', studentId: '20250001' }])
  })

  it('읽을 수 없는 줄이 있으면 짚어 주고 저장하지 않는다', async () => {
    const onSave = renderView()
    await userEvent.type(screen.getByLabelText('허용 명단'), '홍길동,20250001\n김서연')
    await userEvent.click(screen.getByRole('button', { name: '명단 저장' }))

    expect(screen.getByText(/2번째 줄/)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('줄을 고치면 앞선 문제 표시가 사라진다', async () => {
    renderView()
    await userEvent.type(screen.getByLabelText('허용 명단'), '김서연')
    await userEvent.click(screen.getByRole('button', { name: '명단 저장' }))
    expect(screen.getByText(/2번째 줄|1번째 줄/)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('허용 명단'), ',20250002')
    expect(screen.queryByText(/번째 줄/)).not.toBeInTheDocument()
  })

  it('저장하는 동안 버튼이 잠긴다', () => {
    renderView({ saving: true })
    expect(screen.getByRole('button', { name: '저장하는 중…' })).toBeDisabled()
  })
})
