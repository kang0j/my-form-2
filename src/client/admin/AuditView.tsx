import type { AuditReport } from '../../server/db/audit'

export function AuditView({ report }: { report: AuditReport }) {
  const { duplicateIdentities, duplicateDevices, sharedNetworks, integrity } = report
  const totalFindings = duplicateIdentities.length + duplicateDevices.length + sharedNetworks.length
  const allClear = integrity.consistent && totalFindings === 0

  return (
    <>
      <h2>이상 징후</h2>

      {!integrity.consistent && (
        <p className="audit-alarm">
          정합성 경보: 명부 {integrity.participantCount}건, 응답 {integrity.submissionCount}건.
        </p>
      )}

      {allClear ? (
        <div className="audit-allclear">
          <p className="audit-allclear__title">이상이 없어요.</p>
          <p className="audit-allclear__body">
            신원 중복, 기기 중복, 동일 네트워크 어느 쪽에서도 겹치는 제출이 없어요.
          </p>
        </div>
      ) : (
        <>
          {/* 위계: 신원 중복 > 기기 중복 > 동일 네트워크. 동일 네트워크는 학교
              와이파이만으로도 흔히 생기는 잡음이라 가장 옅게 보여준다. */}
          <div className="audit-section audit-section--high">
            <p
              className={`audit-section__headline${
                duplicateIdentities.length === 0 ? ' audit-section__headline--zero' : ''
              }`}
            >
              신원 중복 {duplicateIdentities.length}건
            </p>
            {duplicateIdentities.length > 0 && (
              <ul className="audit-entry-list">
                {duplicateIdentities.map((entry) => (
                  <li key={`${entry.name}-${entry.studentId}`} className="audit-entry">
                    <span className="audit-entry__id">
                      {entry.name} / {entry.studentId}
                    </span>
                    <span className="audit-entry__meta">
                      {entry.count}건 · IP 해시 {entry.ipHashes.map((h) => h.slice(0, 8)).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="audit-section audit-section--mid">
            <p
              className={`audit-section__headline${
                duplicateDevices.length === 0 ? ' audit-section__headline--zero' : ''
              }`}
            >
              기기 중복 {duplicateDevices.length}건
            </p>
            {duplicateDevices.length > 0 && (
              <ul className="audit-entry-list">
                {duplicateDevices.map((entry) => (
                  <li key={entry.browserKeyHash} className="audit-entry">
                    <span className="audit-entry__id">{entry.browserKeyHash.slice(0, 8)}…</span>
                    <span className="audit-entry__meta">{entry.count}건</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="audit-section audit-section--low">
            <p
              className={`audit-section__headline${
                sharedNetworks.length === 0 ? ' audit-section__headline--zero' : ''
              }`}
            >
              동일 네트워크 {sharedNetworks.length}건
            </p>
            {sharedNetworks.length > 0 && (
              <ul className="audit-entry-list">
                {sharedNetworks.map((entry) => (
                  <li key={entry.ipHash} className="audit-entry">
                    <span className="audit-entry__id">{entry.ipHash.slice(0, 8)}…</span>
                    <span className="audit-entry__meta">{entry.count}명 · 학교 와이파이라면 정상이에요.</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  )
}
