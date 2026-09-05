import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { requireAdmin } from '../../src/server/access'

function appWith(envOverrides: Record<string, string>) {
  const app = new Hono()
  app.use('*', requireAdmin)
  app.get('/', (c) => c.text('통과'))
  return (headers: Record<string, string> = {}) =>
    app.request('/', { headers }, envOverrides)
}

describe('requireAdmin', () => {
  it('insecure-local 이면 통과시킨다', async () => {
    const res = await appWith({ ADMIN_AUTH_MODE: 'insecure-local' })()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('통과')
  })

  it('설정이 없으면 열어주지 않고 500 을 낸다', async () => {
    const res = await appWith({})()
    expect(res.status).toBe(500)
  })

  it('모르는 모드도 열어주지 않는다', async () => {
    const res = await appWith({ ADMIN_AUTH_MODE: 'whatever' })()
    expect(res.status).toBe(500)
  })

  it('access 모드에서 헤더가 없으면 401 이다', async () => {
    const res = await appWith({
      ADMIN_AUTH_MODE: 'access',
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'aud-value',
    })()
    expect(res.status).toBe(401)
  })

  it('access 모드인데 팀 도메인 설정이 없으면 500 이다', async () => {
    const res = await appWith({ ADMIN_AUTH_MODE: 'access' })({
      'Cf-Access-Jwt-Assertion': 'token',
    })
    expect(res.status).toBe(500)
  })

  it('토큰이 올바르지 않으면 401 이다', async () => {
    const res = await appWith({
      ADMIN_AUTH_MODE: 'access',
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'aud-value',
    })({ 'Cf-Access-Jwt-Assertion': 'not-a-real-jwt' })
    expect(res.status).toBe(401)
  })
})
