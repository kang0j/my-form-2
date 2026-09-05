import { useEffect, useState } from 'react'
import type { RosterReport } from '../../server/db/allowlist'
import type { Identity } from '../../shared/identity'
import { formatAllowlistText, parseAllowlistText } from './allowlistText'

type Props = {
  /** 저장돼 있는 허용 명단. 편집칸의 초기값이 된다. */
  entries: Identity[]
  /** 명단이 실제로 켜져 있는지만 본다 — 참가 현황은 「참가자」 탭이 맡는다. */
  roster: RosterReport
  saving: boolean
  onSave: (entries: Identity[]) => void
}

/**
 * 누가 낼 수 있는지만 정하는 화면이다.
 *
 * 참가 현황(누가 냈고 누가 안 냈는지)은 「참가자」 탭이 맡는다. 예전에는 이
 * 화면이 둘을 함께 들고 있었는데, 그러면 "누가 참여했는가"가 이 화면과 점검
 * 화면 두 곳에 흩어진다. 그 질문에 답하는 자리를 하나로 모으면서, 이 화면에는
 * 설정만 남겼다 — 관리자가 여기서 하는 일은 명단을 붙이거나 고치는 것뿐이다.
 */
export function RosterView({ entries, roster, saving, onSave }: Props) {
  const [text, setText] = useState(() => formatAllowlistText(entries))
  const [problems, setProblems] = useState<string[]>([])

  // 저장이 끝나 서버가 준 명단이 바뀌면 편집칸도 그 값으로 맞춘다 —
  // 정규화·중복 접기가 실제로 무엇을 했는지 관리자가 눈으로 보게 된다.
  useEffect(() => {
    setText(formatAllowlistText(entries))
  }, [entries])

  function save() {
    const parsed = parseAllowlistText(text)
    // 읽을 수 없는 줄을 조용히 버리고 저장하면, 관리자는 30명을 넣었다고
    // 믿는데 29명만 들어간다. 남은 한 명은 투표 당일 문 앞에서야 안다.
    if (parsed.problems.length > 0) {
      setProblems(parsed.problems)
      return
    }
    setProblems([])
    onSave(parsed.entries)
  }

  return (
    <div className="roster-view">
      <div className="field-row">
        <label className="field-row__label" htmlFor="allowlist-text">
          허용 명단
        </label>
        <p className="roster-hint">
          한 줄에 한 사람씩, 이름과 학번을 적어 주세요. 쉼표·탭·공백 다 괜찮아요.
        </p>
        <textarea
          id="allowlist-text"
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            // 고치는 중에 앞선 지적이 남아 있으면 방금 고친 줄이 또 틀린
            // 것처럼 읽힌다.
            setProblems([])
          }}
        />
      </div>

      {problems.length > 0 && (
        <ul className="submit-errors" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {!roster.enabled && (
        <p className="notice">명단을 비워 두면 링크를 가진 누구나 참여할 수 있어요.</p>
      )}

      <div className="action-row">
        <button type="button" className="primary" disabled={saving} onClick={save}>
          {saving ? '저장하는 중…' : '명단 저장'}
        </button>
      </div>

    </div>
  )
}
