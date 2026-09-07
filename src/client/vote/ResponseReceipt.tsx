import { useState } from 'react'

/**
 * 낸 사람이 들고 가는 영수증 — 자기 응답에 붙은 번호.
 *
 * 화면의 주인공이 아니다. 이 화면이 하는 말은 「제출했어요」이고, 번호는
 * 필요할 때 찾아보는 참조값이다. 그래서 작고 흐리게, 화면 아래 구석에
 * 앉는다(§.receipt 의 margin-top:auto). 크게 세우면 36자 문자열이 제목보다
 * 먼저 눈에 들어오고, 어깨너머로 읽히기도 쉽다.
 *
 * 처음에는 앞 8자리만 보인다. 자기 것을 알아보는 데는 그걸로 충분하고,
 * 전체가 필요한 사람만 눌러서 편다. 접힘/펼침은 목록 전체가 함께 움직인다 —
 * 여러 줄이 서로 다른 길이로 서면 어느 줄이 펼쳐진 것인지가 길이로만
 * 구분되고, 그건 눈이 읽어야 할 차이가 아니다.
 */
const SHORT_LENGTH = 8

function shorten(id: string): string {
  return id.length > SHORT_LENGTH ? `${id.slice(0, SHORT_LENGTH)}…` : id
}

export function ResponseReceipt({
  ids,
  onEdit,
}: {
  ids: string[]
  /** 여러 응답이 이 기기에 남아 있을 때만 준다 — 어느 것을 고칠지는 사람이 고른다. */
  onEdit?: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (ids.length === 0) return null

  return (
    <p className="receipt">
      <span className="receipt__label">응답 ID</span>

      {ids.map((id) => (
        <span className="receipt__item" key={id}>
          <button
            type="button"
            className="receipt__code"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? id : shorten(id)}
            <span className="sr-only">{expanded ? ' — 눌러서 접기' : ' — 눌러서 전체 보기'}</span>
          </button>

          {onEdit && (
            <button type="button" className="receipt__edit" onClick={() => onEdit(id)}>
              수정
            </button>
          )}
        </span>
      ))}
    </p>
  )
}
