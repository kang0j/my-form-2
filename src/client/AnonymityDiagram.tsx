import type { CSSProperties } from 'react'

/**
 * 표지 도해의 세 줄.
 *
 * 한 줄은 [명부 기록] ─ 이음 ─ [응답 기록] 이다. 세 줄이 이어져 있다가
 * 이음이 가운데부터 지워지고, 이음이 사라진 뒤 응답 기록들이 **자리를 서로
 * 바꾼다** — 답은 그대로 다 있는데 어느 줄이 누구 것인지가 사라진다.
 * DB 가 하는 일과 같은 모양이다: 명부와 응답을 한 배치로 함께 쓰되 잇는
 * 열이 없고(§recordSubmission), 응답에는 시각이 없고 PK 가 랜덤 UUID 라
 * 저장 순서로도 이을 수 없다.
 *
 * `w` 는 응답 기록의 폭이다. 셋이 서로 달라야 섞인 것이 눈에 보인다 —
 * 폭이 같으면 자리를 바꿔도 그림이 그대로다. 명부 기록은 반대로 셋 다
 * 같은 모양이다(이름·학번은 늘 같은 두 칸짜리 기록이다).
 *
 * `slot` 은 섞인 뒤 가서 앉는 줄 번호다. 반드시 순열이어야 하고(자리가
 * 비거나 겹치면 안 된다) 어떤 줄도 제자리에 남으면 안 된다 — 하나라도
 * 남으면 그 줄은 짝이 살아난다.
 */
const CUT_ROWS = [
  { i: 0, w: '100%', slot: 2 },
  { i: 1, w: '52%', slot: 0 },
  { i: 2, w: '76%', slot: 1 },
] as const

/**
 * 이음 한 줄을 이루는 조각들. 가운데(인덱스 3)에서 바깥으로 순서대로
 * 지워지도록 `d`(가운데로부터의 거리)를 지연에 쓴다 — 한꺼번에 사라지면
 * 그냥 꺼진 것이고, 가운데부터 벌어져야 끊어진 것으로 읽힌다.
 */
const TIE_SEGMENTS = [0, 1, 2, 3, 4, 5, 6].map((s) => ({ s, d: Math.abs(s - 3) }))

/**
 * 익명 도해. 표지와 「시작하기」 직후의 모달이 같은 그림을 쓴다 — 모달에서
 * 처음 보는 그림이면 읽는 데 시간이 걸리지만, 방금 본 그림이면 확인하는
 * 데 시간이 안 걸린다.
 *
 * 열 이름만 밖에서 받는다. 투표 흐름의 문구는 전부 한국어지만(PRODUCT.md
 * §제약) 첫 화면은 영어라, 같은 그림이 두 언어에 서야 한다. 기본값은
 * 한국어다 — 이 그림이 원래 살던 곳이 투표 흐름이라, 부르는 쪽이 아무것도
 * 넘기지 않으면 거기 문구가 나와야 한다.
 */
export function AnonymityDiagram({
  rosterLabel = '참가자 명단',
  answersLabel = '응답',
}: {
  rosterLabel?: string
  answersLabel?: string
} = {}) {
  return (
    <div className="principle__stage">
      {/* 열 이름은 진짜 글자다 — 이게 없으면 두 덩이가 무엇인지 알 길이
          없어 그림이 해석되지 않는다. 도형 줄만 그림이라 aria-hidden 이고,
          이름은 접근성 트리에 남는다.

          부제(「이름 · 학번」/「고른 답」)는 걷어냈다. 무엇이 담기는지는
          바로 아래 도형 줄이 이미 같은 모양으로 보여주고 있어서, 글자로
          한 번 더 말하면 그림을 읽기 전에 설명부터 읽게 된다. */}
      <div className="stage__head">
        <span className="stage__col">
          <span className="stage__col-name">{rosterLabel}</span>
        </span>
        <span className="stage__col stage__col--answer">
          <span className="stage__col-name">{answersLabel}</span>
        </span>
      </div>

      <div className="stage__rows" aria-hidden="true">
        {CUT_ROWS.map((row) => (
          <div key={row.i} className="stage__row">
            <span className="stage__record">
              <span className="stage__field stage__field--name" />
              <span className="stage__field stage__field--id" />
            </span>
            <span className="stage__tie">
              {TIE_SEGMENTS.map((seg) => (
                <span key={seg.s} className="stage__seg" style={{ '--d': seg.d } as CSSProperties} />
              ))}
            </span>
            <span className="stage__answer-cell">
              <span
                className="stage__answer"
                style={{ '--w': row.w, '--i': row.i, '--shift': row.slot - row.i } as CSSProperties}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
