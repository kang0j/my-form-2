import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RosterReport } from '../../src/server/db/allowlist'
import type { ParticipantRow } from '../../src/server/db/audit'
import { ParticipantsView } from '../../src/client/admin/ParticipantsView'

const emptyRoster: RosterReport = {
  enabled: false,
  participated: [],
  notParticipated: [],
  unlisted: [],
}

const roster: RosterReport = {
  enabled: true,
  participated: [{ name: '홍길동', studentId: '20250001' }],
  notParticipated: [
    { name: '김서연', studentId: '20250002' },
    { name: '박도현', studentId: '20250003' },
  ],
  unlisted: [],
}

function participant(name: string, studentId: string): ParticipantRow {
  return {
    id: `p-${studentId}`,
    name,
    studentId,
    submittedAt: Date.UTC(2026, 8, 4, 3, 0),
    ipHash: 'ip',
    uaHash: 'ua',
  }
}

function renderView(overrides: {
  roster?: RosterReport
  participants?: ParticipantRow[]
} = {}) {
  render(
    <ParticipantsView
      roster={overrides.roster ?? emptyRoster}
      participants={overrides.participants ?? []}
    />,
  )
}

describe('ParticipantsView', () => {
  // 관리자가 실제로 하는 것은 뺄셈이다 — 명단 몇 명 중 몇 명이 냈는가.
  // 그 뺄셈을 머릿속에 맡기지 않는 것이 이 한 줄의 일이다.
  it('명단이 있으면 명단 대비 참여 수를 한 줄로 말한다', () => {
    renderView({ roster, participants: [participant('홍길동', '20250001')] })
    expect(screen.getByText('명단 3명 중 1명 참여')).toBeInTheDocument()
  })

  it('명단이 없으면 참가자 수만 말한다', () => {
    renderView({ participants: [participant('홍길동', '20250001')] })
    expect(screen.getByText('참가자 1명')).toBeInTheDocument()
  })

  // 마감 전에 관리자가 하려는 일은 하나다: 아직 안 낸 사람에게 연락하기.
  // 그래서 수가 아니라 이름으로, 그리고 맨 위에 온다.
  it('미참가자를 이름으로 보여준다', () => {
    renderView({ roster })
    expect(screen.getByText(/아직 안 낸 사람 2명/)).toBeInTheDocument()
    expect(screen.getByText('김서연')).toBeInTheDocument()
    expect(screen.getByText('박도현')).toBeInTheDocument()
  })

  it('모두 냈으면 남은 사람이 없다고 알린다', () => {
    renderView({
      roster: { ...roster, notParticipated: [] },
      participants: [participant('홍길동', '20250001')],
    })
    expect(screen.getByText(/명단에 있는 사람이 모두 냈어요/)).toBeInTheDocument()
  })

  it('명단이 없으면 미참가 자리를 만들지 않는다', () => {
    renderView({ participants: [participant('홍길동', '20250001')] })
    expect(screen.queryByText(/아직 안 낸 사람/)).not.toBeInTheDocument()
  })

  it('낸 사람을 제출 시각과 함께 표로 보여준다', () => {
    renderView({ participants: [participant('홍길동', '20250001')] })
    expect(screen.getByText(/낸 사람 1명/)).toBeInTheDocument()
    expect(screen.getByText('홍길동')).toBeInTheDocument()
    // KST = UTC+9. 03:00Z 는 12:00 이다.
    expect(screen.getByText('2026-09-04 12:00')).toBeInTheDocument()
  })

  // 같은 사람을 표와 목록 두 곳에 내보내지 않는다 — 행에 표식만 붙인다.
  it('명단에 없는데 낸 사람은 행에 표시한다', () => {
    renderView({
      roster: { ...roster, unlisted: [{ name: '낯선이', studentId: '20259999' }] },
      participants: [participant('낯선이', '20259999')],
    })
    expect(screen.getByText('명단에 없음')).toBeInTheDocument()
  })

  it('명단이 꺼져 있으면 명단에 없음 표식을 붙이지 않는다', () => {
    renderView({ participants: [participant('낯선이', '20259999')] })
    expect(screen.queryByText('명단에 없음')).not.toBeInTheDocument()
  })

  it('아무도 안 냈으면 그렇게 말한다', () => {
    renderView({})
    expect(screen.getByText(/아직 아무도 내지 않았어요/)).toBeInTheDocument()
  })
})
