import { identityKey, normalizeIdentity, type Identity } from '../../shared/identity'

/**
 * 허용 명단을 관리자가 손으로 다루는 형태(붙여넣은 여러 줄 텍스트)와
 * 서버가 다루는 형태(신원 배열) 사이를 옮긴다.
 *
 * 관리자는 개발자가 아니고, 명단의 출처는 대개 카카오톡 대화, 엑셀 한 칸,
 * 손으로 적은 메모다. 그래서 "형식을 지켜서 넣어라"고 요구하는 대신 셋을
 * 다 받는다 — 쉼표(타이핑), 탭(엑셀 복사), 공백(메모장 복사).
 */

export type ParsedAllowlist = {
  /** 읽어낸 신원. 문제가 있는 줄이 섞여 있어도 읽힌 줄은 그대로 담긴다. */
  entries: Identity[]
  /** 사람이 고쳐야 하는 줄. 비어 있지 않으면 저장하지 않는다. */
  problems: string[]
}

/**
 * 한 줄을 이름과 학번으로 가른다.
 *
 * 쉼표나 탭이 있으면 그것이 관리자가 의도한 구분자다 — 첫 번째 것에서
 * 가르고, 뒤에 남은 것은 통째로 학번으로 본다.
 *
 * 구분자가 공백뿐이면 마지막 공백에서 가른다. 「홍 길동 20250001」처럼
 * 이름에 공백이 든 사람이 실제로 있고, 학번은 언제나 마지막 칸이기
 * 때문이다. 첫 공백에서 갈랐다면 이 사람의 학번이 「길동 20250001」이
 * 되어 명단에 있는데도 문 앞에서 막힌다.
 */
function splitLine(line: string): [string, string] | null {
  const explicit = line.search(/[,\t]/)
  if (explicit !== -1) {
    return [line.slice(0, explicit), line.slice(explicit + 1)]
  }

  const lastSpace = line.search(/\s+\S*$/)
  if (lastSpace === -1) return null

  return [line.slice(0, lastSpace), line.slice(lastSpace)]
}

export function parseAllowlistText(text: string): ParsedAllowlist {
  const byKey = new Map<string, Identity>()
  const problems: string[] = []

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (line === '') return

    const parts = splitLine(line)
    const identity = parts ? normalizeIdentity(parts[0], parts[1]) : null

    // 조용히 버리지 않는다. 관리자가 30명을 넣었다고 믿는데 29명만 들어가면,
    // 남은 한 명은 투표 당일 문 앞에서야 그 사실을 알게 된다.
    if (!identity || identity.name === '' || identity.studentId === '') {
      problems.push(`${index + 1}번째 줄: 이름과 학번을 함께 적어 주세요. — 「${line}」`)
      return
    }

    // 같은 사람이 두 줄로 들어온 것은 흔한 일이고 관리자가 고칠 잘못이
    // 아니다. 조용히 하나로 접는다.
    byKey.set(identityKey(identity), identity)
  })

  return { entries: [...byKey.values()], problems }
}

/** 저장된 명단을 다시 편집할 수 있는 텍스트로 되돌린다. parseAllowlistText 로 되읽으면 같은 명단이 나온다. */
export function formatAllowlistText(entries: Identity[]): string {
  return entries.map((entry) => `${entry.name},${entry.studentId}`).join('\n')
}
