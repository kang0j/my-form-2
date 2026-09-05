import type { RosterReport } from '../../server/db/allowlist'
import type { ParticipantRow } from '../../server/db/audit'
import { identityKey } from '../../shared/identity'
import { formatKst } from '../../shared/kst'

/**
 * 누가 참여했는지에 답하는 한 자리.
 *
 * 예전에는 이 질문이 두 화면에 흩어져 있었다 — 「명단」 화면이 명단 대비
 * 참가 현황을, 「점검」 화면이 제출 시각이 붙은 명부를 각각 들고 있었다.
 * 같은 사람들을 두 번 세는 목록이 둘이면 관리자는 어느 쪽이 진짜인지 묻게
 * 된다. 그래서 하나로 모으고, 점검은 이상 징후만 남겼다.
 *
 * 순서는 관리자가 다음에 할 일을 따른다: 아직 안 낸 사람이 먼저 오고 이름으로
 * 온다 — 마감 전에 하려는 일이 그 몇 명에게 연락하는 것이기 때문이다. 낸
 * 사람은 그 뒤에 표로 온다.
 */
export function ParticipantsView({
  roster,
  participants,
}: {
  roster: RosterReport
  participants: ParticipantRow[]
}) {
  // 명단에 없는데 낸 사람을 표에서 표시하기 위한 집합. 키는 공유
  // identityKey 를 그대로 쓴다 — 이름과 학번을 공백으로 이어 붙이면
  // 「홍 길동」+「1」과 「홍」+「길동 1」이 같은 키가 되어, 명단에 있는
  // 사람이 「명단에 없음」으로 서거나 그 반대가 된다(§identityKey).
  const unlisted = new Set(roster.unlisted.map(identityKey))

  return (
    <div className="participants-view">
      {/* 명단을 켠 설문에서 관리자가 실제로 하는 것은 뺄셈이다 — "명단 30명,
          제출 27건, 그래서 세 명이 남았다". 그 뺄셈을 머릿속에 맡기지 않고
          한 줄로 먼저 말한다. */}
      <p className="participants-summary">
        {roster.enabled
          ? `명단 ${roster.participated.length + roster.notParticipated.length}명 중 ${roster.participated.length}명 참여`
          : `참가자 ${participants.length}명`}
      </p>

      {roster.enabled && (
        <section className="roster-section">
          <h2>아직 안 낸 사람 {roster.notParticipated.length}명</h2>
          {roster.notParticipated.length === 0 ? (
            <p className="roster-allclear">명단에 있는 사람이 모두 냈어요.</p>
          ) : (
            <ul className="roster-list">
              {roster.notParticipated.map((person) => (
                <li key={identityKey(person)} className="roster-list__item">
                  <span className="roster-list__name">{person.name}</span>
                  <span className="roster-list__student-id">{person.studentId}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="roster-section">
        <h2>낸 사람 {participants.length}명</h2>
        {participants.length === 0 ? (
          <p className="roster-allclear">아직 아무도 내지 않았어요.</p>
        ) : (
          <table className="audit-table">
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">학번</th>
                <th scope="col">제출 시각(KST)</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => {
                const offList = roster.enabled && unlisted.has(identityKey(p))
                return (
                  <tr key={p.id}>
                    <td data-label="이름">
                      {p.name}
                      {/* 명단을 나중에 붙였거나 명단 없이 열어 둔 동안 들어온
                          제출이다. 별도 목록으로 떼어 놓으면 같은 사람이 표와
                          목록 두 곳에 나오므로 행에 표식만 붙인다. */}
                      {offList && <span className="participants-flag">명단에 없음</span>}
                    </td>
                    <td data-label="학번">{p.studentId}</td>
                    <td data-label="제출 시각(KST)">{formatKst(p.submittedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
