import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify } from 'jose'

type AccessEnv = {
  ADMIN_AUTH_MODE?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
}

// JWKS 는 요청 사이에 재사용해도 안전하다. 사용자별 상태가 아니라 공개키 캐시다.
const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwksFor(teamDomain: string) {
  const cached = jwksByDomain.get(teamDomain)
  if (cached) return cached

  const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
  jwksByDomain.set(teamDomain, jwks)
  return jwks
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const env = c.env as AccessEnv

  if (env.ADMIN_AUTH_MODE === 'insecure-local') return next()

  if (env.ADMIN_AUTH_MODE !== 'access') {
    return c.json({ error: '관리자 인증을 아직 설정하지 않았어요.' }, 500)
  }

  const teamDomain = env.ACCESS_TEAM_DOMAIN
  const audience = env.ACCESS_AUD
  if (!teamDomain || !audience) {
    return c.json({ error: '관리자 인증을 아직 설정하지 않았어요.' }, 500)
  }

  const token = c.req.header('Cf-Access-Jwt-Assertion')
  if (!token) return c.json({ error: '관리자 인증이 필요해요.' }, 401)

  try {
    await jwtVerify(token, jwksFor(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
    })
  } catch {
    return c.json({ error: '관리자 인증을 통과하지 못했어요.' }, 401)
  }

  return next()
}
