import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import type { Pool } from 'pg'
import { registerAuthRoutes } from './auth-routes.ts'

export function buildApp({ pool, appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:5173', trustedProxies = process.env.BFW_TRUSTED_PROXIES?.split(/\s+/).filter(Boolean) ?? [] }: { pool: Pool; appOrigin?: string; trustedProxies?: string[] }) {
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024, trustProxy: trustedProxies.length ? trustedProxies : false })

  app.register(cookie)
  app.register(rateLimit, { global: false, errorResponseBuilder: () => ({ statusCode: 429, error: 'RATE_LIMITED' }) })
  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
  app.register(websocket, { options: { maxPayload: 16 * 1024, perMessageDeflate: false } })

  app.get('/health/live', async () => ({ status: 'ok' }))
  app.get('/health/ready', async (_request, reply) => {
    try {
      const migration = await pool.query('SELECT name FROM schema_migrations WHERE name=$1', ['001_initial.sql'])
      if (!migration.rows.length) return reply.code(503).send({ status: 'unavailable' })
      return { status: 'ok' }
    } catch {
      return reply.code(503).send({ status: 'unavailable' })
    }
  })

  app.register(async instance => {
    registerAuthRoutes(instance, pool, appOrigin)
  })

  return app
}
