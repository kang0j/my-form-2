import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatKst, fromKstInput, toKstInput } from '../../shared/kst'
import { checkRules, surveyToDraft } from '../../shared/rules'
import type { SurveyDef, SurveyDraftInput } from '../../shared/schema'
import type { QuestionResult } from '../../server/aggregate'
import type { RosterReport } from '../../server/db/allowlist'
import type { AuditReport } from '../../server/db/audit'
import type { Identity } from '../../shared/identity'
import { apiGet, apiSend } from '../api'
import { useDocumentTitle } from '../brand'
import { ResultsView } from '../results/ResultsView'
import { AuditView } from './AuditView'
import { ParticipantsView } from './ParticipantsView'
import { RosterView } from './RosterView'
import { STATUS_LABELS } from './statusLabels'
import { SurveyEditor } from './SurveyEditor'

/**
 * 예약 마감 시각 ↔ <input type="datetime-local"> 값.
 *
 * 입력칸도 표시도 **KST 고정**이다(§shared/kst). 브라우저 시간대로 읽으면
 * 시계가 어긋난 기기 하나가 「9시 마감」을 다른 시각으로 적어 보낸다 —
 * 관리자와 투표자가 같은 교실에 있는 앱에서 그 어긋남은 순전한 사고다.
 * 서버에는 절대 시각(epoch ms)만 오간다.
 */
function formatCloseAt(ms: number): string {
  return `${formatKst(ms)} (KST)`
}

type Tab = 'edit' | 'results' | 'participants' | 'allowlist' | 'audit'

/** 아직 안 온 탭 내용의 자리. 빈 화면은 "없다"로 읽힌다 — 기다리는 중이라고 말한다. */
function TabLoading() {
  return <p>불러오고 있어요…</p>
}

/**
 * 탭 순서는 관리자가 설문을 따라가는 순서다: 만들고(편집), 마감 뒤 결과를
 * 보고, 누가 참여했는지 확인하고, 그 참여를 누구에게 열어 둘지 정하고,
 * 마지막으로 이상 징후를 본다.
 *
 * 「참가자」가 「결과」 바로 옆에 오는 것은 둘이 같은 질문의 양쪽이기
 * 때문이다 — 무엇이 나왔는가와 누가 냈는가.
 */
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'edit', label: '편집' },
  { id: 'results', label: '결과' },
  { id: 'participants', label: '참가자' },
  { id: 'allowlist', label: '응답 허용 설정' },
  { id: 'audit', label: '점검' },
]

export function SurveyDetail() {
  const { surveyId = '' } = useParams()
  const navigate = useNavigate()
  const [survey, setSurvey] = useState<SurveyDef | null>(null)
  const [draft, setDraft] = useState<SurveyDraftInput | null>(null)
  const [tab, setTab] = useState<Tab>('edit')
  const [results, setResults] = useState<{ submissionCount: number; results: QuestionResult[] } | null>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [allowlist, setAllowlist] = useState<Identity[] | null>(null)
  const [roster, setRoster] = useState<RosterReport | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [closeAtInput, setCloseAtInput] = useState('')
  // 삭제는 두 단계다. 한 번 누르면 무엇이 함께 사라지는지 말하고, 그다음
  // 누름이 실제 삭제다 — 되돌릴 수 없는 일에 확인 한 번은 있어야 한다.
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 저장/설문 열기/마감/복제 요청이 오가는 동안 어떤 버튼을 눌렀는지
  // 기억해 그 버튼만 "…하는 중" 문구로 바꾸고, 그 사이엔 이 화면의 모든
  // 액션 버튼을 disabled 로 묶는다 — 느린 망에서 두 번째 탭이 겹쳐 나가는
  // 것을 막는다(PRODUCT.md: 불안정한 네트워크 전제). pendingRef 는 React
  // state 갱신을 기다리지 않는 즉시 재진입 방지선이다(VoteFlow.submit() 의
  // sendingRef 와 같은 이유 — §C1).
  const [pending, setPending] = useState<
    | null
    | 'open'
    | 'reopen'
    | 'close'
    | 'duplicate'
    | 'save'
    | 'visibility'
    | 'allowlist'
    | 'schedule'
    | 'delete'
  >(null)
  const pendingRef = useRef(false)
  // 탭 목록의 롤빙 tabindex(§WAI-ARIA 탭 패턴) 용 버튼 참조. 화살표로
  // 옮긴 뒤 실제 포커스도 그 탭으로 따라가야 탭 키가 탭 목록을 한 번에
  // 건너뛴다(활성 탭만 tabindex=0, 나머지는 -1).
  const tabButtonRefs = useRef(new Map<Tab, HTMLButtonElement | null>())

  useDocumentTitle(survey?.title)

  function focusTab(t: Tab) {
    setTab(t)
    tabButtonRefs.current.get(t)?.focus()
  }

  function handleTabListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.id === tab)
    if (index === -1) return

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusTab(TABS[(index + 1) % TABS.length].id)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      focusTab(TABS[(index - 1 + TABS.length) % TABS.length].id)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusTab(TABS[0].id)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusTab(TABS[TABS.length - 1].id)
    }
  }

  /**
   * 지금 화면이 보고 있는 설문. 늦게 도착한 응답이 자기 설문의 화면인지
   * 확인하는 데 쓴다.
   *
   * 설문을 바꿔도 이 화면은 그대로 남고 surveyId 만 갈린다(복제 직후가 그
   * 경로다). 그때 앞 설문에 보내 둔 요청이 뒤늦게 도착하면, 아무 확인 없이
   * 받아 적는 코드는 새 설문의 화면에 남의 명단·집계를 세운다 — 관리자가
   * 그걸 보고 「명단 저장」을 누르면 남의 명단이 이 설문에 실제로 박힌다.
   */
  const shownSurveyIdRef = useRef(surveyId)
  shownSurveyIdRef.current = surveyId

  function isStale(requestedId: string): boolean {
    return shownSurveyIdRef.current !== requestedId
  }

  function reload() {
    const requestedId = surveyId
    apiGet<SurveyDef>(`/api/admin/surveys/${requestedId}`)
      .then((loaded) => {
        if (isStale(requestedId)) return
        setSurvey(loaded)
        setDraft(surveyToDraft(loaded))
        // 서버가 방금 말한 예약 시각으로 입력칸을 맞춘다. 예약이 지나
        // 마감된 설문은 서버가 close_at 을 그대로 들고 있으므로, 관리자는
        // 언제로 잡았었는지를 계속 볼 수 있다.
        setCloseAtInput(toKstInput(loaded.closeAt))
      })
      .catch((e: Error) => {
        if (!isStale(requestedId)) setMessage(e.message)
      })
  }

  useEffect(reload, [surveyId])

  // 다른 설문으로 넘어가면(복제 직후가 그 경로다) 이 화면은 그대로 남고
  // surveyId 만 바뀐다. 앞 설문의 집계·명단·점검 결과를 지우지 않으면 새
  // 설문의 탭에 남의 숫자가 잠깐 서 있는다.
  useEffect(() => {
    setResults(null)
    setReport(null)
    setAllowlist(null)
    setRoster(null)
    setConfirmDelete(false)
  }, [surveyId])

  useEffect(() => {
    const requestedId = surveyId

    // 마감 전에는 서버가 집계를 주지 않는다(§requireClosedForResults). 물어
    // 보고 409 를 받아 오류 문구를 띄우는 대신, 아예 묻지 않고 화면이 그
    // 이유를 먼저 말한다.
    if (tab === 'results' && survey?.status === 'closed') {
      apiGet<{ submissionCount: number; results: QuestionResult[] }>(
        `/api/admin/surveys/${requestedId}/results`,
      )
        .then((loaded) => {
          if (!isStale(requestedId)) setResults(loaded)
        })
        .catch((e: Error) => {
          if (!isStale(requestedId)) setMessage(e.message)
        })
    }
    // 참가자 화면은 두 곳을 함께 읽는다 — 제출 시각이 붙은 명부는 점검
    // 보고서에, 명단 대비 미참가는 명단 보고서에 있다.
    if (tab === 'audit' || tab === 'participants') {
      apiGet<AuditReport>(`/api/admin/surveys/${requestedId}/audit`)
        .then((loaded) => {
          if (!isStale(requestedId)) setReport(loaded)
        })
        .catch((e: Error) => {
          if (!isStale(requestedId)) setMessage(e.message)
        })
    }
    if (tab === 'allowlist' || tab === 'participants') {
      void loadRoster(requestedId)
    }
  }, [tab, surveyId, survey?.status])

  /**
   * 허용 명단과 참가 현황을 함께 읽는다.
   *
   * 둘을 따로 받으면 명단을 저장한 직후 화면이 잠깐 어긋난다 — 새 명단은
   * 들어왔는데 현황은 아직 옛 명단으로 계산된 것이라, 방금 넣은 사람이
   * 미참가 목록에 없다. 관리자는 저장이 안 된 줄 알고 한 번 더 누른다.
   */
  async function loadRoster(requestedId: string): Promise<void> {
    try {
      const [listed, report] = await Promise.all([
        apiGet<{ entries: Identity[] }>(`/api/admin/surveys/${requestedId}/allowlist`),
        apiGet<RosterReport>(`/api/admin/surveys/${requestedId}/roster`),
      ])
      if (isStale(requestedId)) return
      setAllowlist(listed.entries)
      setRoster(report)
    } catch (e) {
      if (!isStale(requestedId)) setMessage((e as Error).message)
    }
  }

  function saveAllowlist(entries: Identity[]) {
    const requestedId = surveyId
    return runAction('allowlist', async () => {
      try {
        await apiSend(`/api/admin/surveys/${requestedId}/allowlist`, 'PUT', { entries })
        if (isStale(requestedId)) return
        setMessage(null)
        await loadRoster(requestedId)
      } catch (e) {
        if (!isStale(requestedId)) setMessage((e as Error).message)
      }
    })
  }

  async function runAction(
    kind:
      | 'open'
      | 'reopen'
      | 'close'
      | 'duplicate'
      | 'save'
      | 'visibility'
      | 'allowlist'
      | 'schedule'
      | 'delete',
    fn: () => Promise<void>,
  ) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(kind)
    try {
      await fn()
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  function act(
    kind: 'open' | 'reopen' | 'close' | 'visibility' | 'schedule',
    path: string,
    body?: unknown,
  ) {
    return runAction(kind, async () => {
      try {
        await apiSend(`/api/admin/surveys/${surveyId}${path}`, 'POST', body)
        setMessage(null)
        reload()
      } catch (e) {
        setMessage((e as Error).message)
      }
    })
  }

  function save() {
    if (!draft) return
    // 조건 규칙이 깨진 초안은 서버가 400 으로 거부한다(§routes/admin.ts).
    // 보내 놓고 거부당하느니 아예 보내지 않는다 — 무엇이 깨졌는지는 편집기가
    // 저장 버튼 바로 위에 이미 적어 두었고, 버튼도 그동안 잠겨 있다.
    if (checkRules(draft).length > 0) return
    return runAction('save', async () => {
      try {
        await apiSend(`/api/admin/surveys/${surveyId}`, 'PUT', draft)
        setMessage('저장했어요.')
        reload()
      } catch (e) {
        setMessage((e as Error).message)
      }
    })
  }

  function remove() {
    return runAction('delete', async () => {
      try {
        await apiSend(`/api/admin/surveys/${surveyId}`, 'DELETE')
        navigate('/admin')
      } catch (e) {
        setConfirmDelete(false)
        setMessage((e as Error).message)
      }
    })
  }

  function duplicate() {
    return runAction('duplicate', async () => {
      try {
        const copy = await apiSend<{ id: string }>(
          `/api/admin/surveys/${surveyId}/duplicate`,
          'POST',
        )
        navigate(`/admin/surveys/${copy.id}`)
      } catch (e) {
        setMessage((e as Error).message)
      }
    })
  }

  if (!survey || !draft) {
    return (
      <main>
        <p>{message ?? '불러오고 있어요…'}</p>
      </main>
    )
  }

  const locked = survey.status !== 'draft'
  // 편집기가 화면에 띄우는 것과 같은 판단이다(§SurveyEditor ruleProblems) —
  // 그 목록이 서 있는 동안에는 저장이 잠긴다.
  const ruleProblems = checkRules(draft)

  return (
    <main>
      <h1>{survey.title}</h1>

      <p className="survey-status">
        <span className="survey-status__label">{STATUS_LABELS[survey.status]}</span>
        <span className="survey-status__link">
          투표 링크 <code>/s/{survey.id}</code>
        </span>
      </p>

      {message && <p className="notice">{message}</p>}

      <div className="action-row">
        {survey.status === 'draft' && (
          <button type="button" disabled={pending !== null} onClick={() => act('open', '/open')}>
            {pending === 'open' ? '여는 중…' : '설문 열기'}
          </button>
        )}
        {survey.status === 'open' && (
          <button type="button" disabled={pending !== null} onClick={() => act('close', '/close')}>
            {pending === 'close' ? '마감하는 중…' : '마감하기'}
          </button>
        )}
        {survey.status === 'closed' && (
          <button type="button" disabled={pending !== null} onClick={() => act('reopen', '/reopen')}>
            {pending === 'reopen' ? '여는 중…' : '다시 열기'}
          </button>
        )}
        <button type="button" disabled={pending !== null} onClick={duplicate}>
          {pending === 'duplicate' ? '복제하는 중…' : '설문 복제'}
        </button>
      </div>

      {/* 재개는 결과 공개에 부작용이 하나 있다: 「마감 후」로 걸어 둔 설문은
          지금 결과가 보이는 상태인데, 다시 열면 status 가 open 이 되면서
          isResultsPublic 이 도로 거짓이 된다(src/server/routes/public.ts).
          동작을 바꾸는 대신 누르기 전에 그 결과를 말해 준다 — 왜 그런지는
          적지 않는다. 관리자 화면의 안내는 한 문장이다(§관리자 문구). */}
      {survey.status === 'closed' && survey.resultsVisibility === 'after_close' && (
        <p className="notice">다시 열면 결과가 다시 가려져요.</p>
      )}

      {/* 예약 마감. 크론이 도는 것이 아니라 마감 시각이 지난 뒤 누군가
          이 설문을 읽는 순간 마감된다(§settleDueSurveys) — 그 사이에 들어올
          수 있는 제출은 없으므로(제출도 읽기로 시작한다) 관리자에게는
          "그 시각에 마감된다"와 같은 말이다. */}
      <div className="schedule-row">
        <label className="schedule-row__label" htmlFor="survey-close-at">
          예약 마감 (KST)
        </label>
        <input
          id="survey-close-at"
          type="datetime-local"
          value={closeAtInput}
          disabled={pending !== null || survey.status === 'closed'}
          onChange={(e) => setCloseAtInput(e.target.value)}
        />
        <button
          type="button"
          disabled={pending !== null || survey.status === 'closed'}
          onClick={() => act('schedule', '/schedule', { closeAt: fromKstInput(closeAtInput) })}
        >
          {pending === 'schedule' ? '저장하는 중…' : '예약 저장'}
        </button>
        {survey.closeAt !== null && survey.status !== 'closed' && (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => {
              setCloseAtInput('')
              return act('schedule', '/schedule', { closeAt: null })
            }}
          >
            예약 해제
          </button>
        )}
      </div>
      {survey.closeAt !== null && survey.status === 'open' && (
        <p className="notice">{formatCloseAt(survey.closeAt)}에 마감돼요.</p>
      )}
      {survey.closeAt !== null && survey.status === 'draft' && (
        <p className="notice">설문을 열면 {formatCloseAt(survey.closeAt)}에 마감돼요.</p>
      )}

      <div className="action-row action-row--exports">
        <a href={`/api/admin/surveys/${surveyId}/export?type=responses`}>응답 CSV</a>
        <a href={`/api/admin/surveys/${surveyId}/export?type=roster`}>참가자 CSV</a>
      </div>

      <div
        className="tab-list"
        role="tablist"
        aria-label="설문 상세 화면"
        onKeyDown={handleTabListKeyDown}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabButtonRefs.current.set(t.id, el)
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            className="tab"
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'edit' && (
        <div id="tabpanel-edit" role="tabpanel" aria-labelledby="tab-edit">
          {locked && (
            <p className="notice lock-notice">
              {STATUS_LABELS[survey.status]} 설문은 문항을 바꿀 수 없어요. 결과 공개 설정만 바꿀
              수 있어요.
            </p>
          )}
          {/* key 는 설문이 바뀔 때 편집기를 새로 세운다. 편집기는 보기·문항·
              섹션의 React key 를 ref 에 들고 있어서(§SurveyEditor 로컬 id),
              그대로 남으면 새 설문의 구조와 어긋난 지도를 밟는다. */}
          <SurveyEditor key={surveyId} draft={draft} onChange={setDraft} locked={locked} />
          <div className="action-row">
            {!locked ? (
              <button
                type="button"
                className="primary"
                disabled={pending !== null || ruleProblems.length > 0}
                onClick={save}
              >
                {pending === 'save' ? '저장하는 중…' : '저장'}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={pending !== null}
                onClick={() =>
                  act('visibility', '/visibility', { resultsVisibility: draft.resultsVisibility })
                }
              >
                {pending === 'visibility' ? '저장하는 중…' : '결과 공개 설정 저장'}
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'edit' && (
        <div className="danger-zone">
          {confirmDelete ? (
            <>
              <p className="notice notice--warn">
                이 설문과 문항·명단·명부·응답이 모두 지워져요. 되돌릴 수 없어요.
              </p>
              <div className="action-row">
                <button type="button" disabled={pending !== null} onClick={remove}>
                  {pending === 'delete' ? '지우는 중…' : '정말 삭제'}
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </button>
              </div>
            </>
          ) : (
            <button type="button" disabled={pending !== null} onClick={() => setConfirmDelete(true)}>
              설문 삭제
            </button>
          )}
        </div>
      )}

      {tab === 'results' && (
        <div id="tabpanel-results" role="tabpanel" aria-labelledby="tab-results">
          {survey.status !== 'closed' ? (
            <p className="notice">마감한 뒤에 결과를 볼 수 있어요.</p>
          ) : results ? (
            <ResultsView submissionCount={results.submissionCount} results={results.results} />
          ) : (
            <TabLoading />
          )}
        </div>
      )}

      {tab === 'participants' && (
        <div id="tabpanel-participants" role="tabpanel" aria-labelledby="tab-participants">
          {roster !== null && report !== null ? (
            <ParticipantsView roster={roster} participants={report.participants} />
          ) : (
            <TabLoading />
          )}
        </div>
      )}

      {tab === 'allowlist' && (
        <div id="tabpanel-allowlist" role="tabpanel" aria-labelledby="tab-allowlist">
          {allowlist !== null && roster !== null ? (
            <RosterView
              entries={allowlist}
              roster={roster}
              saving={pending === 'allowlist'}
              onSave={saveAllowlist}
            />
          ) : (
            <TabLoading />
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div id="tabpanel-audit" role="tabpanel" aria-labelledby="tab-audit">
          {report ? <AuditView report={report} /> : <TabLoading />}
        </div>
      )}
    </main>
  )
}
