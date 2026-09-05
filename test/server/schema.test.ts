import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

async function columns(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return results.map((r) => r.name)
}

describe('익명성 스키마 불변식', () => {
  it('응답 섬에 명부 섬을 가리키는 컬럼이 없다', async () => {
    const submissionCols = await columns('submissions')
    const answerCols = await columns('answers')

    for (const col of [...submissionCols, ...answerCols]) {
      expect(col).not.toBe('participant_id')
      expect(col).not.toBe('name')
      expect(col).not.toBe('student_id')
      expect(col).not.toBe('ip_hash')
      expect(col).not.toBe('ua_hash')
    }
  })

  it('submissions 에는 어떤 시각 컬럼도 없다', async () => {
    const cols = await columns('submissions')
    expect(cols).not.toContain('submitted_on')
    expect(cols).not.toContain('submitted_at')
    expect(cols).not.toContain('created_at')
    expect(cols).not.toContain('timestamp')
    expect(cols.sort()).toEqual(['browser_key_hash', 'id', 'survey_id'])
  })

  it('submissions 의 외래키는 surveys 만 가리킨다', async () => {
    const { results } = await env.DB
      .prepare('PRAGMA foreign_key_list(submissions)')
      .all<{ table: string }>()
    expect(results.map((r) => r.table)).toEqual(['surveys'])
  })

  it('IP·UA 해시는 명부 쪽에만 있다', async () => {
    expect(await columns('participants')).toEqual(
      expect.arrayContaining(['ip_hash', 'ua_hash']),
    )
  })
})
