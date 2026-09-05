import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiSend } from '../api'
import { STATUS_LABELS } from './statusLabels'

type Summary = {
  id: string
  title: string
  status: 'draft' | 'open' | 'closed'
  resultsVisibility: string
  participantCount: number
}

export function SurveyList() {
  const [surveys, setSurveys] = useState<Summary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // 느린 망에서 두 번째 탭이 겹쳐 나가 설문이 두 개 생기지 않도록(§fix 8).
  const creatingRef = useRef(false)

  function reload() {
    apiGet<Summary[]>('/api/admin/surveys')
      .then(setSurveys)
      .catch((e: Error) => setError(e.message))
  }

  useEffect(reload, [])

  async function create() {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      await apiSend<{ id: string }>('/api/admin/surveys', 'POST', {
        title: '새 설문',
        description: '',
        resultsVisibility: 'after_close',
        // 빈 섹션 하나로 시작한다 — 편집기가 「문항 추가」를 걸 자리가
        // 있어야 하고, 새 설문은 어차피 화면 한 장짜리로 출발한다.
        sections: [{ questions: [] }],
      })
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <main>
      <h1>설문 관리</h1>
      {error && <p className="error">{error}</p>}

      <div className="admin-toolbar">
        <button type="button" className="primary" disabled={creating} onClick={create}>
          {creating ? '만드는 중…' : '새 설문 만들기'}
        </button>
      </div>

      {surveys === null && !error && <p>불러오고 있어요…</p>}

      {surveys !== null && surveys.length === 0 && (
        <div className="empty-state">
          <p className="empty-state__title">아직 만든 설문이 없어요</p>
          <p className="empty-state__body">위 「새 설문 만들기」로 첫 설문을 만들어 보세요.</p>
        </div>
      )}

      {surveys !== null && surveys.length > 0 && (
        <ul className="survey-list">
          {surveys.map((survey) => (
            <li key={survey.id} className="survey-list__row">
              <Link className="survey-list__title" to={`/admin/surveys/${survey.id}`}>
                {survey.title}
              </Link>
              <span className="survey-list__meta">
                <span className="survey-list__status">{STATUS_LABELS[survey.status]}</span>
                <span>참여 {survey.participantCount}명</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
