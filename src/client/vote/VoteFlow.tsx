import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { allQuestions } from '../../shared/schema'
import type { QuestionDef, SectionDef, SurveyDef } from '../../shared/schema'
import { validateSubmission } from '../../shared/validation'
import { computeVisibility } from '../../shared/visibility'
import { AnonymityDiagram } from '../AnonymityDiagram'
import { apiGet, apiSend } from '../api'
import { SITE_NAME, useDocumentTitle } from '../brand'
import { useVoteWorldGround } from '../ground'
import {
  clearDraft,
  clearSubmitted,
  getBrowserKey,
  hasSubmitted,
  loadDraft,
  markSubmitted,
  rememberSubmittedIds,
  saveDraft,
  submittedIds,
} from '../storage'
import { ResponseReceipt } from './ResponseReceipt'
import { ChoiceQuestion } from './ChoiceQuestion'
import { RankingQuestion } from './RankingQuestion'
import { TextQuestion } from './TextQuestion'
import {
  buildAnswers,
  collectAnswers,
  emptyDraft,
  toPersisted,
  type PersistedDraft,
  type VoteDraft,
} from './draft'

export type PublicSurvey = SurveyDef & { resultsAvailable: boolean }

/**
 * 화면 한 장이 곧 한 걸음이다. 'section' 은 예전의 'question' 자리를
 * 그대로 물려받았다 — 다른 것은 그 한 장에 문항이 여럿 놓인다는 것뿐이다.
 *
 * 제출 전 검토 화면은 없앴다. 마지막 화면의 버튼이 「제출하기」이고 그
 * 자리에서 곧장 나간다 — 답을 한 번 더 훑는 화면은 이미 답한 것을 그대로
 * 다시 읽게 할 뿐이고, 고칠 것이 있으면 「뒤로」가 그 화면을 그대로
 * 되돌려 준다.
 */
type Step = 'revisit' | 'intro' | 'section' | 'done'
type Direction = 'forward' | 'back'

/**
 * 인앱 브라우저 툴바가 100vh 를 가려버리는 문제(§B2) 대응. dvh 를 우선
 * 쓰되, 이를 못 읽는 구형 WebView 를 위해 실제 가시 높이를 유지해서
 * --app-height 로도 내려준다.
 */
/**
 * 스크롤은 있으면 쓰고 없으면 넘어간다.
 *
 * jsdom 에는 Element.scrollTo·scrollIntoView 가 아예 없다 — 그런데 이
 * 화면에서 스크롤은 연출이지 사실을 만드는 일이 아니다(어느 문항이 걸렸는지는
 * 문제 문구가 말한다). 없는 환경에서 예외를 던져 렌더 전체를 무너뜨리는
 * 대신 조용히 건너뛴다.
 */
function scrollToTop(el: HTMLElement | null | undefined): void {
  el?.scrollTo?.({ top: 0 })
}

/**
 * 「움직임 줄이기」를 켠 사람에게는 부드러운 스크롤도 움직임이다. 그쪽에는
 * 즉시 이동으로 돌려준다 — 자리를 옮기는 일 자체는 해야 하기 때문이다.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function scrollIntoView(
  el: HTMLElement | null | undefined,
  block: ScrollLogicalPosition,
  behavior: ScrollBehavior = 'auto',
): void {
  el?.scrollIntoView?.({ block, behavior: behavior === 'smooth' && prefersReducedMotion() ? 'auto' : behavior })
}

function useAppHeight(): void {
  useEffect(() => {
    function setHeight() {
      document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`)
    }
    setHeight()
    window.addEventListener('resize', setHeight)
    window.addEventListener('orientationchange', setHeight)
    return () => {
      window.removeEventListener('resize', setHeight)
      window.removeEventListener('orientationchange', setHeight)
      // 투표 화면을 벗어나면 값을 지운다 — 안 지우면 클라이언트 라우팅으로
      // 넘어간 결과·관리자 화면에 이 설문의 뷰포트 높이가 그대로 남는다.
      document.documentElement.style.removeProperty('--app-height')
    }
  }, [])
}

/**
 * 문항 하나만 담은 임시 설문에 대해 공유 authority(`validateSubmission`)를
 * 그대로 돌린다. 문항 화면을 넘어갈 때 "이 문항만" 검증하기 위한 것이지,
 * 별도의 검증 로직을 새로 만드는 게 아니다 — 최종 제출 전 검증과 항상
 * 같은 말을 한다.
 */
function questionProblems(survey: SurveyDef, question: QuestionDef, draft: VoteDraft): string[] {
  const subSurvey: SurveyDef = { ...survey, sections: [{ id: question.id, questions: [question] }] }
  const answers = buildAnswers(subSurvey, draft)
  // validateSubmission 은 survey.status 와 answers 만 본다(src/shared/validation.ts)
  // — 이름·학번·browserKey 는 검사하지 않으므로 빈 문자열로 채운다. 예전의
  // '-'/'--------' 는 서버의 최소 8자 browserKey 제약과 맞춘 것처럼 보이지만
  // 그 제약을 이 함수는 전혀 확인하지 않는다.
  const result = validateSubmission(subSurvey, {
    name: '',
    studentId: '',
    browserKey: '',
    answers,
  })
  return result.ok ? [] : result.errors
}

/**
 * 한 섹션의 문항들을 한꺼번에 검사해서 문항 id → 첫 문제 로 돌려준다.
 *
 * 화면이 넘어가는 단위가 섹션이므로 검사도 섹션 단위다. 첫 번째 문제에서
 * 멈추지 않는 것은, 스크롤로 죽 훑어 내려온 사람에게 문제를 하나씩만
 * 알려주면 「다음」을 문제 개수만큼 눌러야 하기 때문이다 — 한 번에 다
 * 보여주고, 화면은 그중 첫 번째로 데려간다.
 */
/**
 * 이 화면에서 아직 아무것도 고르지 않았는가.
 *
 * 넘어가는 버튼이 「다음」인지 「건너뛰기」인지를 가른다 — 아무것도 안 고른
 * 채 넘어가는 것이 허용된다는 사실을, 눌러 보기 전에 버튼이 먼저 말한다.
 *
 * 랭킹 문항은 처음부터 순서를 하나 들고 있어서(§emptyDraft) 손대지 않아도
 * 답이 만들어진다 — 랭킹이 있는 화면은 「건너뛰기」로 서지 않는다. 실제로
 * 그 화면은 건너뛰어도 빈 답이 아니라 기본 순서가 저장되므로, 버튼이
 * 「다음」이라고 말하는 편이 사실에 맞다.
 */
function sectionUntouched(survey: SurveyDef, section: SectionDef, draft: VoteDraft): boolean {
  return buildAnswers({ ...survey, sections: [section] }, draft).length === 0
}

function sectionProblems(
  survey: SurveyDef,
  section: SectionDef,
  draft: VoteDraft,
): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const question of section.questions) {
    const found = questionProblems(survey, question, draft)
    if (found.length > 0) problems[question.id] = found[0]
  }
  return problems
}

/**
 * 「시작하기」와 1번 문항 사이에 한 번 서는 모달.
 *
 * 표지의 도해는 스크롤 아래에 있어 그냥 지나칠 수 있다. 이 판은 확인을
 * 누르지 않으면 넘어가지 않으므로, 답을 고르기 시작하는 사람은 적어도 한
 * 번은 "무엇이 어디에 남는지"를 본 상태가 된다.
 *
 * 화면을 통째로 갈아 끼우지 않는다 — 표지 위에 판이 뜨고, 뒤의 표지는
 * 가림막 아래 그대로 있다. 별도 페이지로 넘어가면 적어 둔 이름·학번이
 * 사라진 것처럼 보이고, 되돌아올 곳이 눈에 안 보인다.
 *
 * 취소는 표지로 되돌릴 뿐 문항으로 보내지 않는다 — 확인을 우회하는 길이
 * 아니라, 갇히지 않게 하는 문이다.
 */
function AnonymityDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  /**
   * 포커스를 이 화면 안에 가둔다. 뒤에 남아 있는 표지의 입력란·버튼으로
   * 탭이 새어 나가면, 화면은 덮여 있는데 포커스는 안 보이는 곳에 있는
   * 상태가 된다 — 스크린리더·키보드 사용자에게 그 순간 화면이 사라진다.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key !== 'Tab') return

    const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button, a[href]')
    if (!focusables || focusables.length === 0) return

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement

    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    // 바깥 한 겹은 가림막이다 — 표지를 지우지 않고 어둡게 눌러 둔 채, 그 위에
    // 판 한 장이 뜬다. 판이 화면을 통째로 덮지 않으므로 "돌아갈 곳이 뒤에
    // 있다"가 눈에 보인다. 가림막을 눌러서는 닫히지 않는다 — 이 판은 확인을
    // 받는 문이라, 손가락이 스쳐 지나가는 것으로 지나쳐지면 안 된다. 닫는
    // 길은 「뒤로」와 Escape 둘뿐이다.
    <div className="anon-scrim">
      <div
        className="anon-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="anon-dialog-title"
        ref={panelRef}
        onKeyDown={handleKeyDown}
      >
        <div className="anon-dialog__body">
          <h2 className="anon-dialog__title" id="anon-dialog-title">
            참가자와 응답이 연결되지 않습니다.
          </h2>

          <AnonymityDiagram />

          {/* 한 문장이면 충분하다. 어떻게 이어지지 않는지(공통 열 없음, 시각
              없음, 저장 순서 안 드러남)는 바로 위 그림이 이미 보여주고 있고,
              글로 한 번 더 늘어놓으면 그림을 읽기 전에 설명부터 읽게 된다. */}
          {/* 굵기로 한 조각만 들어 올리지 않는다 — 이 문장은 전부가 요점이라
              어디를 굵게 해도 나머지가 곁가지로 읽힌다. */}
          <p className="anon-dialog__text">
            참가자 정보는 명부에, 답변은 집계를 위한 응답에 따로 저장되어 작성자를 알 수 없습니다.
          </p>

          <p className="anon-dialog__source">
            <a href="https://github.com/kang0j/my-form-2" target="_blank" rel="noopener noreferrer">
              Github에서 소스코드 확인하기
            </a>
          </p>
        </div>

        <div className="action-bar">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            뒤로
          </button>
          <button type="button" className="btn-primary" ref={confirmRef} onClick={onConfirm}>
            시작하기
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 진행 표시. 숫자를 세지 않고 바로만 말한다.
 *
 * 조건 분기가 들어오면 "3 / 7" 이 거짓말이 된다 — 7화면이라 해놓고 실제로는
 * 5화면만 보여준다. 총계를 가시 화면 수로 다시 계산하면 정확해지지만, 답을
 * 바꿀 때마다 분모가 튄다. 바가 조금 되돌아가는 편이 숫자가 튀는 것보다
 * 훨씬 조용하다.
 *
 * 지운 것은 시각적 표현이지 정보가 아니다 — aria-valuetext 가 같은 말을
 * 스크린리더에 그대로 한다.
 */
function ProgressBar({ position, total }: { position: number; total: number }) {
  const ratio = total > 0 ? position / total : 1
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={position}
      aria-valuemin={1}
      aria-valuemax={Math.max(total, 1)}
      aria-valuetext={`${total}화면 중 ${position}번째`}
    >
      <span className="progress__fill" style={{ '--progress': ratio } as CSSProperties} />
    </div>
  )
}

export function VoteFlow() {
  const { surveyId = '' } = useParams()
  const [survey, setSurvey] = useState<PublicSurvey | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('intro')
  // 위치를 배열 인덱스가 아니라 섹션 id 로 든다. 가시 목록이 답에 따라
  // 바뀌므로, 인덱스로 들면 앞 화면의 답을 고친 순간 같은 번호가 다른
  // 화면을 가리킨다.
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null)
  const [direction, setDirection] = useState<Direction>('forward')
  const [draft, setDraft] = useState<VoteDraft | null>(null)
  // 문항 id → 그 문항의 첫 문제. 섹션 하나에 문항이 여럿이므로 문제도
  // 여럿일 수 있고, 각 문제는 그 문항 바로 아래에 선다.
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [submitErrors, setSubmitErrors] = useState<string[]>([])
  const [duplicateIdentity, setDuplicateIdentity] = useState(false)
  // 이 기기가 이 설문에 낸 응답 ID. 완료·재방문·마감 어느 화면에서든 이
  // 값이 있으면 영수증이 선다.
  const [receiptIds, setReceiptIds] = useState<string[]>([])
  // 지금 갈아 끼우는 중인 응답. null 이면 새로 내는 중이다. 이 값이 있으면
  // 제출이 새 행을 만들지 않고 그 응답의 답만 바꾼다(§replaceSubmission).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // 표지의 허용 명단 조회 상태. 제출(sending)과 따로 두는 이유는 두 버튼이
  // 서로 다른 화면에 있고 라벨도 다르기 때문이다.
  const [checking, setChecking] = useState(false)
  // 「시작하기」를 누른 뒤 문항으로 들어가기 직전에 한 번 서는 모달.
  // 표지의 도해는 스크롤 아래에 있어 그냥 지나칠 수 있는데, 이 화면은
  // 확인을 누르지 않으면 넘어가지 않는다. 기기당 한 번이 아니라 매번
  // 띄운다 — 공용 노트북 하나를 여럿이 돌려 쓰는 것이 정상 사용이라
  // (PRODUCT.md) 한 번만 띄우면 다음 사람은 못 본다.
  const [showAnonymity, setShowAnonymity] = useState(false)
  const [introProblem, setIntroProblem] = useState<string | null>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  // 문항 블록의 DOM. 「다음」에서 걸린 문항이나 검토에서 「수정」으로 지목한
  // 문항으로 화면을 데려갈 때 쓴다.
  const questionRefs = useRef(new Map<string, HTMLDivElement | null>())
  // 다음 렌더가 끝나면 이 문항으로 스크롤한다는 예약. 스크롤은 화면이
  // 그려진 뒤에야 할 수 있어서 state 가 아니라 ref 로 넘긴다.
  const scrollTargetRef = useRef<string | null>(null)
  // 방금 답이 확정된 객관식(하나) 문항. 그 다음 문항으로 화면을 내려보내는
  // 예약이다 — 어느 문항이 "다음"인지는 이 답이 반영된 렌더에서야 정해진다
  // (조건으로 새 문항이 그때 나타날 수 있다).
  const advanceFromRef = useRef<string | null>(null)
  // 재진입 방지는 state 가 아니라 ref 로 한다: 같은 렌더 사이에 큐잉된 여러
  // 이벤트(Enter 오토리핏, 더블 탭)는 state 갱신을 기다리지 않고 곧바로
  // submit() 을 다시 부르므로, sending state 만으로는 두 번째 호출을 막지
  // 못한다(§C1). ref 는 즉시 반영된다.
  const sendingRef = useRef(false)
  // 「시작하기」도 같은 이유로 ref 가 필요하다: 느린 망에서 두 번 누르면
  // 조회가 두 번 나가고, 늦게 온 답이 이미 넘어간 화면을 뒤집는다.
  const checkingRef = useRef(false)

  useAppHeight()
  useVoteWorldGround()
  useDocumentTitle(survey?.title)

  useEffect(() => {
    let cancelled = false

    apiGet<PublicSurvey>(`/api/surveys/${surveyId}`)
      .then((loaded) => {
        if (cancelled) return
        setSurvey(loaded)
        const empty = emptyDraft(loaded)
        const persisted = loadDraft<PersistedDraft>(surveyId)
        // 이름·학번은 절대 저장된 값을 쓰지 않는다: 한 기기를 다음 사람이 이어 쓸 때
        // 앞 사람의 신원이 자동으로 채워지면 안 된다(§I6). 답변 칸만 복원한다.
        setDraft(persisted ? { ...empty, ...persisted, name: '', studentId: '' } : empty)
        setStep(hasSubmitted(surveyId) ? 'revisit' : 'intro')
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message)
      })

    return () => {
      cancelled = true
    }
  }, [surveyId])

  /**
   * 이 기기의 영수증을 챙긴다.
   *
   * 보통은 기기에 적혀 있다 — 제출할 때 받아 두기 때문이다. 이 기능이 생기기
   * 전에 낸 기기에는 "냈다"는 표시만 있고 번호가 없어서, 그때만 브라우저 키를
   * 들고 서버에 되묻는다(§/receipts). 기기에 적힌 값이 있으면 그쪽이 언제나
   * 옳다 — 공용 노트북에서 「추가 제출」로 넘긴 앞사람의 번호까지 끌어오지
   * 않기 위해서다.
   *
   * 설문이 열렸는지 닫혔는지는 보지 않는다. 마감된 설문에서도 자기가 낸
   * 번호는 확인할 수 있어야 한다.
   */
  useEffect(() => {
    if (!surveyId || !hasSubmitted(surveyId)) return

    const known = submittedIds(surveyId)
    if (known.length > 0) {
      setReceiptIds(known)
      return
    }

    let cancelled = false

    apiSend<{ submissionIds: string[] }>(`/api/surveys/${surveyId}/receipts`, 'POST', {
      browserKey: getBrowserKey(),
    })
      .then(({ submissionIds }) => {
        if (cancelled || submissionIds.length === 0) return
        rememberSubmittedIds(surveyId, submissionIds)
        setReceiptIds(submissionIds)
      })
      .catch(() => {
        // 영수증은 덤이다. 못 되살려도 화면은 그대로 선다.
      })

    return () => {
      cancelled = true
    }
  }, [surveyId])

  // 지금까지의 답으로 무엇이 보이는지 매 렌더 정한다. 답이 바뀌면 화면
  // 목록도 함께 바뀐다 — 그래서 현재 위치를 배열 인덱스가 아니라 섹션 id 로
  // 든다(currentSectionId).
  //
  // 가시성 계산에 넣는 답은 buildAnswers 가 아니라 collectAnswers 다.
  // buildAnswers 는 이미 가시 문항만 담지만(그 안에서 다시 computeVisibility
  // 를 부른다), 여기서 필요한 것은 "지금 초안에 적힌 모든 답"이다 — 같은
  // 계산을 두 번 돌릴 이유가 없다.
  const visibility =
    survey && draft
      ? computeVisibility(
          survey,
          new Map(collectAnswers(survey, draft).map((a) => [a.questionId, a])),
        )
      : { sections: new Set<string>(), questions: new Set<string>() }

  // 빈 섹션은 화면에서 아예 없는 것으로 친다. 관리자가 편집 중에 문항을
  // 다 지운 섹션을 남겨 둘 수 있고(§sectionDraftSchema), 조건 때문에 그
  // 화면의 문항이 전부 숨는 일도 있다 — 둘 다 보여줄 이유가 없다.
  const sections = survey
    ? survey.sections
        .filter((s) => visibility.sections.has(s.id))
        .map((s) => ({ ...s, questions: s.questions.filter((q) => visibility.questions.has(q.id)) }))
        .filter((s) => s.questions.length > 0)
    : []
  const totalSections = sections.length
  const questions = survey ? allQuestions(survey) : []
  // 지금 보고 있는 화면이 방금 숨겨졌을 수 있다(앞 화면으로 돌아가 답을
  // 바꾼 경우). 그때는 그 자리에 가장 가까운 화면으로 흘러가게 둔다.
  const sectionIndex = Math.max(
    0,
    sections.findIndex((s) => s.id === currentSectionId),
  )
  const currentSection = step === 'section' ? (sections[sectionIndex] ?? null) : null

  /**
   * 보기 하나를 고르면 그 아래 문항으로 내려간다.
   *
   * 객관식(하나)에만 건다. 여러 개 고르기는 첫 보기를 누른 순간 아직 고르는
   * 중이고, 주관식은 입력하는 중이며, 랭킹은 끌어 옮기는 중이다 — 그 셋을
   * 화면이 끌고 내려가면 하던 일이 끊긴다.
   *
   * 다음 문항이 없으면 화면 끝까지 내린다. 마지막 문항을 답한 사람이 다음에
   * 할 일은 아래 버튼을 누르는 것이고, 긴 화면에서는 그 버튼이 접혀 있다.
   */
  useEffect(() => {
    const from = advanceFromRef.current
    if (!from) return
    advanceFromRef.current = null
    if (!currentSection) return

    const here = currentSection.questions.findIndex((q) => q.id === from)
    if (here < 0) return

    // 답을 고른 뒤의 이동은 눈이 따라갈 수 있어야 한다 — 화면이 탁 바뀌면
    // 어디로 왔는지 다시 찾아야 하고, 방금 고른 답이 위로 사라진 것처럼
    // 읽힌다. 그래서 여기만 부드럽게 굴린다(다른 스크롤은 화면 전환이라
    // 즉시가 맞다).
    const next = currentSection.questions[here + 1]
    if (next) {
      scrollIntoView(questionRefs.current.get(next.id), 'start', 'smooth')
      return
    }
    const screen = screenRef.current
    screen?.scrollTo?.({
      top: screen.scrollHeight,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  })

  // 화면이 바뀔 때마다 포커스를 새 화면으로 옮긴다 — 스크린리더·키보드
  // 사용자가 이전 화면에 남겨진 채 갇히지 않도록. survey 는 로딩이 끝나고
  // null → 값으로 바뀌는 순간에도 이 효과가 다시 돌아야 한다 — 그러지
  // 않으면 표지가 막 나타나는 바로 그 순간 포커스가 <body> 에 남는다.
  useEffect(() => {
    // preventScroll: 포커스 이동이 스크롤 영역을 끌어올려 상단 진행 표시를 밀어내지 않게 한다.
    screenRef.current?.focus({ preventScroll: true })

    // 새 섹션은 항상 맨 위에서 시작한다 — 앞 섹션에서 아래까지 내려와 있던
    // 스크롤이 그대로 남으면 다음 화면의 1번 문항을 건너뛴 채로 열린다.
    // 지목된 문항이 있으면(검증에 걸린 문항, 검토에서 「수정」) 거기로 간다.
    const target = scrollTargetRef.current
    scrollTargetRef.current = null

    if (target) {
      scrollIntoView(questionRefs.current.get(target), 'start')
      return
    }
    scrollToTop(screenRef.current)
  }, [step, sectionIndex, survey])

  function update(patch: Partial<VoteDraft>) {
    // setDraft 업데이터 밖에서 next 를 계산한다 — 업데이터는 순수해야 하는데
    // StrictMode 는 업데이터를 두 번 호출하므로, 그 안에서 saveDraft 를 부르면
    // 키 입력마다 localStorage 에 두 번씩 쓴다.
    if (!draft) return
    // 이름·학번을 고치는 순간 앞선 거부 문구는 더 이상 이 화면의 사실이
    // 아니다. 남겨 두면 방금 고친 값이 또 막힌 것처럼 읽힌다.
    setIntroProblem(null)
    const next = { ...draft, ...patch }
    saveDraft(surveyId, toPersisted(next))
    setDraft(next)
  }


  function enterQuestions() {
    if (!survey) return
    setDirection('forward')
    setProblems({})
    // 보여줄 화면이 하나도 없는 설문(문항이 전부 빈 섹션에 있거나 조건으로
    // 다 숨은 경우)은 물을 것이 없다 — 그대로 제출한다.
    if (totalSections === 0) {
      void submit()
      return
    }
    setCurrentSectionId(sections[0]?.id ?? null)
    setStep('section')
  }

  /**
   * 표지의 허용 명단 게이트.
   *
   * 문항에 들어서기 전에 묻는다 — 일곱 문항을 다 푼 뒤에 "명단에 없다"는
   * 말을 들으면 인앱 브라우저에서 그 사람이 할 수 있는 일이 없다. 거부당해도
   * 표지에 그대로 머물러 이름·학번을 곧바로 고칠 수 있어야 한다.
   *
   * 이 조회는 편의일 뿐 게이트의 권위가 아니다 — 진짜 검사는 서버의
   * /submit 에 한 번 더 있다(src/server/routes/public.ts).
   */
  async function startVoting() {
    if (!survey || !draft) return
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setIntroProblem(null)

    try {
      const { allowed } = await apiSend<{ allowed: boolean }>(
        `/api/surveys/${surveyId}/check`,
        'POST',
        { name: draft.name.trim(), studentId: draft.studentId.trim() },
      )

      if (!allowed) {
        setIntroProblem('명단에 없는 이름·학번이에요. 관리자에게 확인해 주세요.')
        return
      }

      // 명단 확인을 통과한 뒤에야 세운다 — 거부당할 사람에게 익명성을
      // 설명하고 나서 되돌리는 것은 순서가 뒤바뀐 것이다.
      setShowAnonymity(true)
    } catch (error) {
      setIntroProblem((error as Error).message)
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }

  function goNext() {
    if (!survey || !draft || !currentSection) return

    const found = sectionProblems(survey, currentSection, draft)
    const firstBad = currentSection.questions.find((q) => found[q.id])
    if (firstBad) {
      setProblems(found)
      // 화면이 이미 그 문항을 비추고 있어도 다시 데려간다 — 긴 섹션에서는
      // 걸린 문항이 위로 한참 밀려 올라가 있는 쪽이 보통이다.
      scrollIntoView(questionRefs.current.get(firstBad.id), 'center')
      return
    }

    setProblems({})
    setDirection('forward')

    // 마지막 화면의 「다음」은 「제출하기」다 — 검토 화면 없이 여기서 곧장
    // 나간다.
    if (sectionIndex >= totalSections - 1) {
      void submit()
    } else {
      setCurrentSectionId(sections[sectionIndex + 1]?.id ?? null)
    }
  }

  function goBack() {
    setProblems({})
    setDirection('back')
    if (sectionIndex === 0) {
      setStep('intro')
    } else {
      setCurrentSectionId(sections[sectionIndex - 1]?.id ?? null)
    }
  }

  async function submit() {
    // 세 번 연타된 Enter, 공용 노트북에서의 다급한 더블 탭 모두 이 시점에
    // 막는다 — 아래 어떤 경로로 return 하든 finally 에서 반드시 풀어준다
    // (§C1). 버튼의 disabled={sending} 은 키보드 경로를 못 막으므로 이 ref
    // 가 유일한 재진입 방지선이다.
    if (sendingRef.current) return
    sendingRef.current = true
    try {
      if (!survey || !draft) return

      const payload = {
        name: draft.name.trim(),
        studentId: draft.studentId.trim(),
        browserKey: getBrowserKey(),
        answers: buildAnswers(survey, draft),
        // 수정 중이면 어느 응답을 갈아 끼우는지 함께 보낸다. 서버는 이 값이
        // 붙어 있을 때만 새 행 대신 그 행을 고친다.
        ...(editingId ? { replaces: editingId } : {}),
      }

      const validation = validateSubmission(survey, payload)
      if (!validation.ok) {
        // 문제를 목록으로만 던지지 않고, 그 문항의 자리로 돌려보낸다 — 상태는
        // 크롬이 아니라 본문 흐름 안에서 말한다(§물려받은 규율).
        const badSection = sections.findIndex((section) =>
          section.questions.some((q) => questionProblems(survey, q, draft).length > 0),
        )
        if (badSection >= 0) {
          const found = sectionProblems(survey, sections[badSection], draft)
          const firstBad = sections[badSection].questions.find((q) => found[q.id])
          setSubmitErrors([])
          setDirection('back')
          setProblems(found)
          scrollTargetRef.current = firstBad?.id ?? null
          setCurrentSectionId(sections[badSection]?.id ?? null)
          setStep('section')
          return
        }
        setSubmitErrors(validation.errors)
        return
      }

      setSubmitErrors([])
      setSending(true)
      try {
        const result = await apiSend<{
          ok: true
          duplicateIdentity: boolean
          submissionId?: string
        }>(`/api/surveys/${surveyId}/submit`, 'POST', payload)

        // 수정은 응답 ID 를 바꾸지 않는다 — 들고 있던 영수증이 그대로 그
        // 응답을 가리켜야 한다. 그래서 기기에 적힌 목록도 손대지 않는다.
        if (!editingId) {
          markSubmitted(surveyId, result.submissionId)
          setReceiptIds(result.submissionId ? [result.submissionId] : [])
        }
        clearDraft(surveyId)
        setDuplicateIdentity(result.duplicateIdentity)
        setStep('done')
      } catch (error) {
        setSubmitErrors([(error as Error).message])
      } finally {
        setSending(false)
      }
    } finally {
      sendingRef.current = false
    }
  }

  function handleSectionKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing) return // 한글 조합 중에는 손대지 않는다.
    if (e.key !== 'Enter') return

    // 주관식 textarea 에서는 Enter 가 줄바꿈으로 그대로 들어가야 하고(§I1),
    // 여기서 화면 전환으로 가로채면 그 순간 두 번째 줄이 이미 없어진 화면에
    // 입력되어 사라진다.
    const active = document.activeElement as HTMLElement | null
    if (
      active?.tagName === 'TEXTAREA' ||
      (active?.tagName === 'INPUT' && (active as HTMLInputElement).type === 'text')
    ) {
      return
    }

    // 포커스가 버튼 등 다른 인터랙티브 요소에 있으면 그 요소의 클릭을
    // 가로채지 않는다(§C2) — 예: 랭킹 문항의 위/아래 버튼에서 Enter 를
    // 누르면 순서를 바꿔야지 화면을 넘겨서는 안 된다.
    //
    // 라디오·체크박스는 예외다. 그 둘에서 Enter 는 원래 아무 일도 하지
    // 않으므로(고르는 키는 Space 다) 가로채도 빼앗는 동작이 없고, 보기를
    // 하나 고르면 포커스가 그 입력에 남는 것이 보통이라 예외로 두지 않으면
    // 답을 고른 사람만 Enter 로 넘어가지 못한다.
    const interactive = (e.target as HTMLElement).closest(
      'button, a, [role="button"], input, select, textarea',
    )
    if (interactive) {
      const type = (interactive as HTMLInputElement).type
      const isChoice =
        interactive.tagName === 'INPUT' && (type === 'radio' || type === 'checkbox')
      if (!isChoice) return
    }

    // 숫자키 1–9 로 보기를 고르던 단축키는 없앴다. 화면에 문항이 하나뿐일
    // 때만 "3 을 누르면 3번 보기"가 뜻이 통했다 — 문항이 여럿 쌓인 화면에서
    // 그 숫자는 어느 문항의 보기인지 말해주지 못한다.
    e.preventDefault()
    if (e.shiftKey) {
      goBack()
    } else {
      goNext()
    }
  }

  function renderQuestion(question: QuestionDef) {
    if (!draft) return null

    // key={question.id} 를 준다 — 같은 종류(예: single→single)의 문항 사이를
    // 넘나들 때는 컴포넌트 타입이 그대로라 React 가 기존 DOM(legend·보기
    // 목록)을 재사용해 버리고, 그러면 .enter-item 진입 애니메이션의
    // CSS animation 이 다시 트리거되지 않는다 — 보기 <li> 들만 id 가 바뀌어
    // 재마운트되고 제목·설명은 그대로 남아 시그니처 인터랙션(§fix 1)이 매
    // 턴 재생되지 않았다. key 를 바꾸면 문항이 바뀔 때마다 이 서브트리
    // 전체가 새로 마운트되어 애니메이션이 항상 다시 재생된다.
    if (question.type === 'text') {
      return (
        <TextQuestion
          key={question.id}
          question={question}
          value={draft.text[question.id] ?? ''}
          onChange={(value) => update({ text: { ...draft.text, [question.id]: value } })}
        />
      )
    }

    if (question.type === 'ranking') {
      return (
        <RankingQuestion
          key={question.id}
          question={question}
          order={draft.ranking[question.id] ?? question.options.map((o) => o.id)}
          onChange={(order) => update({ ranking: { ...draft.ranking, [question.id]: order } })}
        />
      )
    }

    return (
      <ChoiceQuestion
        key={question.id}
        question={question}
        selectedSingle={draft.single[question.id] ?? ''}
        selectedMulti={draft.multi[question.id] ?? []}
        otherText={draft.other[question.id] ?? ''}
        onChangeSingle={(optionId) => {
          update({ single: { ...draft.single, [question.id]: optionId } })
          advanceFromRef.current = question.id
        }}
        onChangeMulti={(optionIds) => update({ multi: { ...draft.multi, [question.id]: optionIds } })}
        onChangeOther={(text) => update({ other: { ...draft.other, [question.id]: text } })}
      />
    )
  }

  // ---- 불러오는 중 / 오류 --------------------------------------------

  if (loadError) {
    return (
      <div className="vote-world">
        <div className="status-screen" ref={screenRef} tabIndex={-1}>
          <h1 className="status-screen__title">{SITE_NAME}</h1>
          <p className="status-screen__notice">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!survey || !draft) {
    return (
      <div className="vote-world">
        <div className="status-screen" ref={screenRef} tabIndex={-1}>
          <p className="status-screen__body">불러오고 있어요…</p>
        </div>
      </div>
    )
  }

  const resultsLink = survey.resultsAvailable ? (
    <p>
      <Link className="status-screen__link" to={`/s/${surveyId}/results`}>
        결과 보기
      </Link>
    </p>
  ) : null

  // ---- 열리지 않은 / 마감된 설문 ---------------------------------------

  if (survey.status !== 'open') {
    return (
      <div className="vote-world">
        <div className="status-screen" ref={screenRef} tabIndex={-1}>
          <h1 className="status-screen__title">{survey.title}</h1>
          <p className="status-screen__body">
            {survey.status === 'closed' ? '마감된 설문이에요.' : '아직 열리지 않은 설문이에요.'}
          </p>
          {resultsLink}
          {/* 마감된 뒤에도 자기가 낸 번호는 확인할 수 있다. 다만 고칠 수는
              없다 — 「응답 수정」은 열려 있는 설문에서만 서므로 여기서는
              영수증만 놓는다. */}
          <ResponseReceipt ids={receiptIds} />
        </div>
      </div>
    )
  }

  // ---- 이미 제출한 기기 --------------------------------------------

  if (step === 'revisit') {
    // 「응답 수정」은 고칠 대상이 하나로 정해질 때만 버튼 자리에 선다. 여러
    // 개가 남아 있는 기기(예전에 「추가 제출」로 여러 명이 낸 공용 노트북)는
    // 어느 것을 고칠지 사람이 골라야 하므로, 그 선택을 영수증 목록 쪽으로
    // 넘기고 여기서는 「추가 제출」만 남긴다.
    const editable = receiptIds.length === 1 ? receiptIds[0] : null

    const startEditing = (id: string) => {
      setEditingId(id)
      // 기존 답은 보여주지 않는다. 고치는 사람이 앞의 답을 다시 보게 되면
      // 그 자리에 남의 답이 떠 있을 수 있고(공용 기기), 무엇보다 이 화면은
      // 처음 낼 때와 같은 백지여야 "새로 적어 낸 것이 그대로 대체된다"는
      // 사실과 어긋나지 않는다.
      clearDraft(surveyId)
      setDraft(emptyDraft(survey))
      setProblems({})
      setSubmitErrors([])
      setIntroProblem(null)
      setDirection('forward')
      setStep('intro')
    }

    return (
      <div className="vote-world">
        <div className="status-screen" ref={screenRef} tabIndex={-1}>
          <h1 className="status-screen__title">{survey.title}</h1>
          <p className="status-screen__notice">이미 제출했어요.</p>

          <p className="status-screen__body">
            낸 답을 고치려면 「응답 수정」이에요 — 응답 ID 는 그대로고, 새로 적은 답이 이전
            답을 대신해요. 한 기기를 여러 명이 함께 쓰고 있다면 「추가 제출」로 이어서 낼 수
            있어요. 단, 같은 기기에서의 추가 제출은 투표 결과 화면에 기기 중복으로 표시돼요.
          </p>

          <div className="status-screen__choices">
            {editable && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => startEditing(editable)}
              >
                응답 수정
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                clearSubmitted(surveyId)
                setEditingId(null)
                setReceiptIds([])
                setDraft(emptyDraft(survey))
                setDirection('forward')
                setStep('intro')
              }}
            >
              추가 제출
            </button>
          </div>

          <ResponseReceipt
            ids={receiptIds}
            onEdit={receiptIds.length > 1 ? startEditing : undefined}
          />
        </div>
      </div>
    )
  }

  // ---- 완료 -----------------------------------------------------

  if (step === 'done') {
    return (
      <div className="vote-world">
        <div className="status-screen" ref={screenRef} tabIndex={-1}>
          <h1 className="status-screen__title">{survey.title}</h1>
          <p className="status-screen__notice">{editingId ? '수정했어요.' : '제출했어요.'}</p>
          {duplicateIdentity && (
            <p className="status-screen__body">
              같은 이름·학번으로 낸 제출이 이미 있어서, 관리자가 한 번 더 확인해요.
            </p>
          )}
          {resultsLink}
          <ResponseReceipt ids={receiptIds} />
        </div>
      </div>
    )
  }

  // ---- 표지 -----------------------------------------------------

  if (step === 'intro') {
    const ready = draft.name.trim() !== '' && draft.studentId.trim() !== ''

    return (
      <div className="vote-world" data-direction={direction}>
        {/* 표지에는 상단 상태 줄이 아예 없다. 왼쪽의 「투표 중」은 화면이
            이미 말하고 있는 것을 한 번 더 말할 뿐이었고, 오른쪽 진행 표시는
            아직 1번 문항에 들어서지 않았으므로 세울 수 없다. 둘 다 사라지면
            남는 것은 빈 줄뿐이라 요소째 걷어내고, 상단 안전영역 여백만
            .screen--no-status 로 넘긴다. */}
        <div
          className="screen screen--no-status"
          ref={screenRef}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              if (ready && !checking) void startVoting()
            }
          }}
        >
          <div className="hero">
            <h1 className="hero__title enter-item" style={{ '--enter-index': 0 } as CSSProperties}>
              {survey.title}
            </h1>
            {survey.description && (
              <p className="hero__description enter-item" style={{ '--enter-index': 1 } as CSSProperties}>
                {survey.description}
              </p>
            )}

            {/* 수정 중이라는 사실은 표지에서 한 번 말해 둔다. 백지로 시작하는
                화면이라 그 말이 없으면 처음 내는 것과 구별되지 않고, 다 적고
                난 뒤 "이전 답이 사라졌다"를 처음 알게 된다. 이름·학번을
                다시 묻는 이유도 이 줄이 함께 답한다. */}
            {editingId && (
              <p
                className="hero__description enter-item"
                style={{ '--enter-index': 2 } as CSSProperties}
              >
                응답을 수정하는 중이에요. 이전 답은 보여주지 않고, 지금 새로 적는 답이 그 자리를
                대신해요. 이름·학번은 처음 낼 때와 똑같이 적어 주세요.
              </p>
            )}
            {/* 문항 수는 표지에서 말하지 않는다.
                조건이 걸린 설문에서 그 수는 상한일 뿐이라 「문항 최대 3개」로
                적어야 했는데, 「최대」가 붙는 순간 그 줄이 답하는 질문이
                없어진다 — 몇 개를 답하게 될지는 여전히 모르고, 시작하기 전에
                알아야 할 일도 아니다. 진행은 문항에 들어선 뒤 진행률 바가
                맡는다(§ProgressBar 가 숫자를 버린 것과 같은 이유). */}

            <div className="field enter-item" style={{ '--enter-index': 3 } as CSSProperties}>
              <label className="field__label" htmlFor="voter-name">
                이름
              </label>
              <input
                id="voter-name"
                className="field__input"
                type="text"
                autoComplete="off"
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>
            <div className="field enter-item" style={{ '--enter-index': 4 } as CSSProperties}>
              <label className="field__label" htmlFor="voter-student-id">
                학번
              </label>
              <input
                id="voter-student-id"
                className="field__input"
                type="text"
                autoComplete="off"
                value={draft.studentId}
                onChange={(e) => update({ studentId: e.target.value })}
              />
            </div>

            {/* 익명성은 문구로 약속하는 것이 아니라 구조로 보여야 한다
                (PRODUCT.md §성공의 모습). 그래서 이 자리에는 설명하는 문장이
                없고 그림만 있다 — 명부와 응답이 이어져 있다가, 이음이
                가운데부터 지워지고, 그러고 나면 응답 쪽이 자리를 서로 바꿔
                어느 줄이 누구 것인지가 사라진다.

                열 이름(명부/응답)만은 진짜 글자로 둔다. 두 덩이가 무엇인지
                모르면 그림이 아예 해석되지 않기 때문이다.

                재료는 잉크로 칠한 <span> 과 opacity·transform 둘뿐이다. SVG 도
                아이콘 폰트도 유니코드 글리프도 쓰지 않아서(§Don't 이미지·
                일러스트·아이콘 자산) 인앱 브라우저에서 깨질 자산이 없다. */}
            <section className="principle">
              <div className="enter-item" style={{ '--enter-index': 5 } as CSSProperties}>
                <AnonymityDiagram />
              </div>

              {/* 그림 아래 한 줄. 예전에는 sr-only 라 눈으로는 볼 수 없었는데,
                  그림만 놓고 보면 "무엇이 따로 저장된다는 것인지"를 스스로
                  풀어내야 한다 — 도해가 하는 말을 글로 한 번 받아 준다.
                  보조기기에도 이 한 문장이 그대로 간다(sr-only 를 따로 두지
                  않는다 — 두면 같은 말을 두 번 듣는다).

                  굵게 하지 않는다. 문장 전체가 요점이라 어느 조각을 들어
                  올려도 나머지가 곁가지로 읽힌다. */}
              <p
                className="principle__text enter-item"
                style={{ '--enter-index': 6 } as CSSProperties}
              >
                참가자 정보는 명부에, 답변은 집계를 위한 응답에 따로 저장되어 작성자를 알 수 없습니다.
              </p>

              <p
                className="principle__source enter-item"
                style={{ '--enter-index': 7 } as CSSProperties}
              >
                <a
                  href="https://github.com/kang0j/my-form-2"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Github에서 소스코드 확인하기
                </a>
              </p>
            </section>
          </div>
        </div>
        <div className="action-bar action-bar--stacked">
          {introProblem && (
            <p className="inline-problem" role="alert">
              {introProblem}
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!ready || checking}
            onClick={startVoting}
          >
            {checking ? '확인하는 중…' : '시작하기'}
          </button>
          {/* 수정을 시작한 사람에게 되돌아갈 문을 남긴다 — 여기서 나가면
              이전 답은 그대로다. 아직 아무것도 보내지 않았기 때문이다. */}
          {editingId && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditingId(null)
                setIntroProblem(null)
                setDraft(emptyDraft(survey))
                setDirection('back')
                setStep('revisit')
              }}
            >
              수정 취소
            </button>
          )}
        </div>

        {/* 표지 위에 뜨는 판이다 — 별도 페이지가 아니다. 뒤의 표지는 가림막
            아래 그대로 남아, 이 판이 "한 걸음 더 간 화면"이 아니라 "잠깐
            멈춰 세운 확인"으로 읽힌다. 이 세계에 그림자는 없으므로
            (§OWN-WORLD) 떠 있음은 그림자가 아니라 헤어라인과 눌린 바탕이
            말한다. role="dialog"·aria-modal·포커스 가둠은 그대로다. */}
        {showAnonymity && (
          <AnonymityDialog
            onConfirm={() => {
              setShowAnonymity(false)
              enterQuestions()
            }}
            onCancel={() => setShowAnonymity(false)}
          />
        )}
      </div>
    )
  }

  // ---- 섹션 -----------------------------------------------------

  if (!currentSection) return null

  return (
    <div className="vote-world" data-direction={direction}>
      {/* 「투표 중」 라벨은 없앴다 — 이 화면 자체가 이미 투표 중이라고
          말한다. 진행은 오른쪽 끝에 눕는 바가 나른다(§ProgressBar) —
          .progress 의 margin-left: auto 가 옛 숫자 자리를 그대로 잇는다.

          바가 세는 것은 문항이 아니라 화면이다. 한 화면에 문항이 여럿
          놓이니 진행이 문항 단위라면 스크롤할 때마다 표시가 움직여야
          하고, 그러면 고정된 자리에 있을 이유가 없다. */}
      <div className="status-row">
        <ProgressBar position={sectionIndex + 1} total={totalSections} />
      </div>
      <div
        className="question-screen"
        ref={screenRef}
        tabIndex={-1}
        onKeyDown={handleSectionKeyDown}
      >
        {currentSection.questions.map((question, index) => (
          <div
            key={question.id}
            className="question-block"
            ref={(el) => {
              questionRefs.current.set(question.id, el)
            }}
            // 첫 문항만 항목 하나하나가 차례로 서고(§DESIGN 모션: 시그니처
            // 인터랙션), 그 뒤 문항들은 덩어리째 뒤따른다. 문항마다 전부
            // 항목 단위로 흩뿌리면 화면 밖에서 아무도 안 보는 애니메이션이
            // 계속 돌고, 아래로 갈수록 지연이 쌓여 스크롤을 따라잡지
            // 못한다. 그래서 지연은 세 칸에서 멈춘다.
            style={{ '--block-index': Math.min(index, 3) } as CSSProperties}
          >
            {renderQuestion(question)}

            {problems[question.id] && (
              <p className="inline-problem" role="alert">
                {problems[question.id]}
              </p>
            )}
          </div>
        ))}

        {/* 제출이 서버·검증에서 막히면 그 말이 설 자리는 이제 여기다 —
            검토 화면이 없어졌으므로 마지막 화면의 문항 아래가 그 자리다. */}
        {submitErrors.length > 0 && (
          <ul className="submit-errors">
            {submitErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="action-bar">
        <button type="button" className="btn-ghost" onClick={goBack}>
          뒤로
        </button>
        <button type="button" className="btn-primary" disabled={sending} onClick={goNext}>
          {/* 아무것도 고르지 않았고 걸릴 것도 없으면 「건너뛰기」다. 필수
              문항이 비어 있는 화면은 실제로 건너뛰지 못하므로 그때는
              「다음」으로 둔다 — 버튼이 못 지킬 말을 하지 않게 한다. */}
          {sectionIndex >= totalSections - 1
            ? sending
              ? '제출하는 중…'
              : '제출하기'
            : draft &&
                sectionUntouched(survey, currentSection, draft) &&
                Object.keys(sectionProblems(survey, currentSection, draft)).length === 0
              ? '건너뛰기'
              : '다음'}
        </button>
      </div>
    </div>
  )
}
