import { useEffect } from 'react'
import { AnonymityDiagram } from './AnonymityDiagram'
import { SITE_NAME } from './brand'
import { useVoteWorldGround } from './ground'

/**
 * 첫 화면(`/`).
 *
 * 이 주소로 오는 사람은 설문을 하러 온 사람이 아니다 — 링크를 받은 사람은
 * `/s/:id` 로 곧장 들어간다. 여기 도착하는 것은 도메인만 보고 "이게 뭐냐"고
 * 확인하러 온 사람이라, 이 화면이 할 일은 설문 목록을 내주는 것이 아니라
 * **이 시스템이 무엇을 약속하는지, 그 약속이 왜 성립하는지**를 보여주는
 * 것이다. 예전에는 「투표 링크를 받아서 들어와 주세요」 한 줄뿐이었다.
 *
 * 그래서 도해가 화면의 중심이다(PRODUCT.md: "믿음은 문구가 아니라 구조에서
 * 나와야 하므로, 그 구조를 화면이 보여줘야 한다"). 표지·모달과 같은
 * `AnonymityDiagram` 을 쓴다 — 세 화면에서 같은 그림을 보면 세 번째에는
 * 읽는 것이 아니라 알아보는 것이 된다.
 *
 * **이 화면만 영어다**(사용자 지시, 2026-09-04). PRODUCT.md 의 "모든 문구는
 * 한국어"는 투표하러 온 학생이 읽는 문구를 가리키고 그쪽은 그대로다 — 이
 * 화면의 독자는 도메인을 보고 들어온 사람이라 다르다. 도해의 열 이름은
 * 그래서 props 로 받는다(기본값은 한국어).
 *
 * 검정 세계에 산다. 투표 흐름과 같은 바탕이라 링크를 눌러 들어간 사람에게
 * 이 두 화면이 한 집처럼 보인다 — 종이 세계(관리자·결과)는 답을 다 받은
 * 뒤의 세계다.
 */
export function HomePage() {
  useVoteWorldGround()

  /**
   * 문서 언어를 이 화면 동안만 영어로 돌린다. index.html 은 <html lang="ko">
   * 이고 나머지 화면은 전부 한국어라 그 값이 맞는데, 여기만 영어 문장이
   * 한국어로 선언된 문서에 실린다 — 스크린리더가 영어 문장을 한국어 음성
   * 엔진으로 읽고, 브라우저 번역이 원문 언어를 잘못 잡는다. 화면을 벗어나면
   * 한국어로 되돌린다(§useVoteWorldGround 와 같은 방식).
   */
  useEffect(() => {
    document.documentElement.lang = 'en'
    return () => {
      document.documentElement.lang = 'ko'
    }
  }, [])

  return (
    <div className="vote-world">
      <main className="home">
        <header className="home__mast">
          <h1 className="home__name">{SITE_NAME}</h1>
          <p className="home__thesis">
            Anonymous surveys where a name and an answer are never linked. Who took part is on the
            record. What each person chose is nowhere.
          </p>
        </header>

        {/* 도해가 하는 말은 아래 문단이 글로도 한다 — 화면에서 글자를 뺀
            것이지 보조기기에서 뺀 것이 아니다. */}
        <section className="home__principle" aria-labelledby="home-principle">
          <h2 className="sr-only" id="home-principle">
            How the anonymity holds
          </h2>

          <AnonymityDiagram rosterLabel="Roster" answersLabel="Answers" />

          <p className="home__principle-text">
            Who you are goes to the roster; what you answered goes to the tally. Both are written in
            the same request, but neither record points at the other — once the writing is done,
            there is no way back from an answer to the person who gave it.
          </p>
        </section>

        {/* 그림이 "이어지지 않는다"를 보이고, 이 줄들이 "무엇이 없어서
            그런가"를 말한다. 목록의 줄이지 카드가 아니다 — 테두리도 배경도
            없이 여백과 굵기로만 갈린다(§Shapes). */}
        <section className="home__grounds" aria-labelledby="home-grounds">
          <h2 className="sr-only" id="home-grounds">
            What is missing on purpose
          </h2>

          <div className="home__ground">
            <h3 className="home__ground-head">No column joins them</h3>
            <p className="home__ground-body">
              The roster and the answers share no field at all. The key that would join them is never
              written in the first place.
            </p>
          </div>

          <div className="home__ground">
            <h3 className="home__ground-head">Answers carry no time</h3>
            <p className="home__ground-body">
              Submission time lives on the roster alone. The answers side keeps not even a date — on a
              day when one person submits, that date is a name tag.
            </p>
          </div>

          <div className="home__ground">
            <h3 className="home__ground-head">Order gives nothing away</h3>
            <p className="home__ground-body">
              Every record is keyed by a random value, and every read comes back in key order. With
              counting keys, storage order would be arrival order, and arrival order lines up with the
              times on the roster.
            </p>
          </div>

          <div className="home__ground">
            <h3 className="home__ground-head">Device traces are hashed</h3>
            <p className="home__ground-body">
              The values used to spot a repeat submission are stored only as hashes, mixed with the
              survey's own ID. The same phone answering two surveys produces two unrelated values, so
              one survey cannot be joined to another.
            </p>
          </div>

          <div className="home__ground">
            <h3 className="home__ground-head">Results open only after closing</h3>
            <p className="home__ground-body">
              Admins included. Read a running tally twice and the difference is the one vote that
              arrived in between — and the roster's timestamps say who arrived then.
            </p>
          </div>
        </section>

        {/* 성질만 말하고 대가를 빼면 광고가 된다. 같은 잉크·같은 스케일로
            적되 굵기만 한 계단 낮춘다 — 자랑이 아니라 조건이라는 뜻이다. */}
        <section className="home__cost" aria-labelledby="home-cost">
          <h2 className="home__cost-label" id="home-cost">
            What this costs
          </h2>
          <p className="home__cost-text">
            Someone voting under another person's name is detected, not blocked. And once detected,
            that single vote cannot be pulled back out — the system does not know which one it is
            either.
          </p>
          <p className="home__cost-text">
            The remedy is to duplicate the survey and run it again. The copy inherits the allowlist and
            starts with an empty roster.
          </p>
        </section>

        <section className="home__entry" aria-labelledby="home-entry">
          <h2 className="home__entry-line" id="home-entry">
            You get in by link, not from here
          </h2>
          <p className="home__entry-note">
            There is no list of surveys at this address. Open the link you were sent.
          </p>
        </section>

        {/* 화면의 마지막 줄. 서명이라 크게 서지 않는다 — 대문자와 자간만으로
            "여기서 끝난다"를 말하고, 그 위 소스코드 링크가 이 주장을 실제로
            확인할 수 있는 곳을 가리킨다. */}
        <footer className="home__colophon">
          <a href="https://github.com/kang0j/my-form-2" target="_blank" rel="noopener noreferrer">
            Read the source on GitHub
          </a>
          <p className="home__signature">POWERED BY JAEHYUN.DEV</p>
        </footer>
      </main>
    </div>
  )
}
