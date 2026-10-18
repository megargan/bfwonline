import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.ts'

const trustedProxies = ['172.18.0.0/16', '172.30.240.1/32', '198.51.100.0/24']
const origin = 'https://example.test'
const pool = { async connect() { return { async query() { return { rows: [] } }, release() {} } } }

test('registration limits separate visitors behind Caddy, IIS and a trusted edge', async t => {
  const app = buildApp({ pool, appOrigin: origin, trustedProxies })
  t.after(() => app.close())
  const register = (clientIp, prefix = '') => app.inject({
    method: 'POST', url: '/api/v1/auth/register', remoteAddress: '172.18.0.4',
    headers: { origin, 'x-forwarded-for': `${prefix}${clientIp}, 198.51.100.10, 172.30.240.1` },
    payload: { username: 'proxy_player', password: 'a long secure password' },
  })

  for (let i = 0; i < 5; i++) assert.equal((await register('203.0.113.21')).statusCode, 201)
  const limited = await register('203.0.113.21', '192.0.2.99, ')
  assert.equal(limited.statusCode, 429)
  assert.equal(limited.json().error, 'RATE_LIMITED')
  assert.equal((await register('203.0.113.22')).statusCode, 201)
})

test('forwarded IPs are ignored unless the immediate peer is trusted', async t => {
  const app = buildApp({ pool, appOrigin: origin, trustedProxies })
  t.after(() => app.close())
  app.get('/test-client-ip', request => ({ ip: request.ip }))
  const response = await app.inject({
    url: '/test-client-ip', remoteAddress: '203.0.113.31',
    headers: { 'x-forwarded-for': '192.0.2.99, 172.30.240.1' },
  })
  assert.equal(response.json().ip, '203.0.113.31')
})
