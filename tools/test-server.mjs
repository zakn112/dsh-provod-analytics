/**
 * Проверка половины Host без запущенного приложения: маршруты `install()`
 * вызываются с поддельным контекстом Cordis, поэтому проверяются и разбор
 * запроса, и форма ответа, и работа с ключом.
 *
 * Запуск: node provod-analytics/tools/test-server.mjs
 */
import assert from 'node:assert/strict'
import { API_PREFIX, install } from '../lib/server.mjs'

const checks = []
function check(name, run) {
  checks.push({ name, run })
}

/** Тело запроса как асинхронный поток байтов, как у `node:http`. */
function makeRequest(url, body, method = 'POST') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8')
    },
  }
}

/** Минимальный `ServerResponse`. */
function makeResponse() {
  return {
    headersSent: false,
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers ?? {}
      this.headersSent = true
    },
    end(text) {
      this.body = text ?? ''
    },
  }
}

/** Ответ Host в виде `{ status, json }`. */
async function callRoute(handler, op, body, method = 'POST') {
  const res = makeResponse()
  await handler(makeRequest(`${API_PREFIX}/${op}`, body, method), res)
  return { status: res.statusCode, json: JSON.parse(res.body) }
}

/** Контекст с подменяемыми сервисами. */
function makeContext(services) {
  const routes = []
  return {
    routes,
    get(name) {
      return services[name]
    },
    fiber: { entry: { id: 'dsh-provod-analytics' } },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
}

function analyticsBody(rows) {
  return { data: { data: rows, metadata: { currency: 'RUB', truncated: false } } }
}

/** Ответ сервиса аналитики для подмены `fetch`. */
function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

check('install: маршрут под префиксом и снятие', () => {
  const ctx = makeContext({})
  const dispose = install(ctx, {}, 'stamp-1')
  assert.equal(ctx.routes.length, 1)
  assert.equal(ctx.routes[0].kind, 'prefix')
  assert.equal(ctx.routes[0].path, API_PREFIX)
  assert.equal(ctx.routes[0].path, '/provod-analytics/api')
  assert.equal(typeof dispose, 'function')
})

check('status: ключа нет', async () => {
  const ctx = makeContext({})
  const dispose = install(ctx, {}, 'stamp-2')
  const { status, json } = await callRoute(ctx.routes[0].handler, 'status', {})
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.value.configured, false)
  assert.equal(json.value.source, null)
  assert.equal(json.value.apiKeyName, 'PROVOD_MANAGEMENT_API_KEY')
  assert.equal(json.value.baseUrl, 'https://api.provod.ai')
  assert.equal(json.value.stamp, 'stamp-2')
  dispose()
})

check('report без ключа: код no-key', async () => {
  const ctx = makeContext({})
  install(ctx, {}, 'stamp-3')
  const { json } = await callRoute(ctx.routes[0].handler, 'report', {})
  assert.equal(json.ok, false)
  assert.equal(json.error.code, 'no-key')
  assert.match(json.error.message, /PROVOD_MANAGEMENT_API_KEY/)
})

check('key: сохранение в хранилище и отчёт', async () => {
  const stored = new Map()
  const credentials = {
    async resolve(name) {
      return stored.has(name) ? { value: stored.get(name), source: 'store' } : undefined
    },
    async describe(name) {
      return { configured: stored.has(name), source: stored.has(name) ? 'store' : undefined, writable: true }
    },
    async set(name, value) {
      stored.set(name, value)
    },
    async unset(name) {
      stored.delete(name)
    },
  }
  const ctx = makeContext({ credentials })
  install(ctx, {}, 'stamp-4')
  const handler = ctx.routes[0].handler

  const before = await callRoute(handler, 'status', {})
  assert.equal(before.json.value.configured, false)

  const saved = await callRoute(handler, 'key', { token: '  mgmt-secret  ' })
  assert.equal(saved.json.ok, true)
  assert.equal(saved.json.value.saved, true)
  assert.equal(saved.json.value.where, 'store')
  assert.equal(stored.get('PROVOD_MANAGEMENT_API_KEY'), 'mgmt-secret')

  const after = await callRoute(handler, 'status', {})
  assert.equal(after.json.value.configured, true)
  assert.equal(after.json.value.source, 'store')
  assert.equal(after.json.value.removable, true, 'ключ из хранилища удаляем')

  const original = globalThis.fetch
  // Отчёт делает четыре запроса подряд; отвечаем по форме тела.
  let call = 0
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    call += 1
    if (body.granularity === 'hour') {
      return fakeResponse(
        200,
        analyticsBody([{ date__hour: '2026-11-20T09:00:00.000Z', total_usage_exact: '0.10000000', request_count: 1 }]),
      )
    }
    if (Array.isArray(body.dimensions) && body.dimensions.includes('generation_id')) {
      return fakeResponse(
        200,
        analyticsBody([
          { model: 'model-a', generation_id: 'gen-1', avg_latency: 2, total_completion_tokens: 400 },
          { model: 'model-a', generation_id: 'gen-2', avg_latency: 8, total_completion_tokens: 1200 },
        ]),
      )
    }
    const rows =
      call === 1
        ? [{ model: 'model-a', total_usage_exact: '0.40000000', request_count: 4 }]
        : [
            { model: 'model-a', total_usage_exact: '3.00000000', request_count: 30, avg_latency: 4 },
            { model: 'model-b', total_usage_exact: '1.20000000', request_count: 10, avg_latency: 2 },
          ]
    return { ok: true, status: 200, text: async () => JSON.stringify(analyticsBody(rows)) }
  }
  try {
    const { json } = await callRoute(handler, 'report', {})
    assert.equal(json.ok, true, JSON.stringify(json))
    assert.equal(json.value.periods.today.totalMicros, '40000000')
    assert.equal(json.value.periods.today.requests, 4)
    assert.equal(json.value.periods.month.totalMicros, '420000000')
    assert.equal(json.value.periods.month.requests, 40)
    assert.equal(json.value.currency, 'RUB')
    assert.equal(json.value.keySource, 'store')
    assert.equal(json.value.periods.month.models[0].model, 'model-a')
    assert.equal(json.value.periods.month.models[0].averageMicros, '10000000')
    assert.equal(json.value.periods.month.requests, 40)
    assert.equal(json.value.periods.month.errors, 0)
    assert.ok(Array.isArray(json.value.daily.days), 'дневная полоса присутствует')
    assert.ok(json.value.daily.days.length > 0)
    assert.ok(json.value.daily.days.every((day) => typeof day.date === 'string' && typeof day.micros === 'string'))
    assert.equal(typeof json.value.forecast.daysInMonth, 'number')
    assert.equal(json.value.latency.samples, 2)
    assert.equal(json.value.latency.models.length, 1)
    assert.equal(json.value.latency.models[0].medianLatency, 5)
    assert.equal(json.value.latency.models[0].p90Latency, 7.4)
    assert.equal(typeof json.value.ranges.month.start, 'string')
    assert.ok(json.value.ranges.month.start < json.value.ranges.today.start)
  } finally {
    globalThis.fetch = original
  }

  const cleared = await callRoute(handler, 'key', { clear: true })
  assert.equal(cleared.json.ok, true)
  assert.equal(cleared.json.value.cleared, true)
  assert.equal(stored.size, 0)
})

check('key: пустой ключ отклонён', async () => {
  const ctx = makeContext({ credentials: { async set() {}, async describe() { return { configured: false } } } })
  install(ctx, {}, 'stamp-5')
  const { status, json } = await callRoute(ctx.routes[0].handler, 'key', { token: '   ' })
  assert.equal(status, 400)
  assert.equal(json.ok, false)
  assert.equal(json.error.code, 'bad-request')
})

check('key: без хранилища — понятная ошибка', async () => {
  const ctx = makeContext({})
  install(ctx, {}, 'stamp-6')
  const { status, json } = await callRoute(ctx.routes[0].handler, 'key', { token: 'k' })
  assert.equal(status, 400)
  assert.equal(json.error.code, 'no-store')
  assert.match(json.error.message, /PROVOD_MANAGEMENT_API_KEY/)
})

check('токен из config.token работает без хранилища', async () => {
  const ctx = makeContext({})
  install(ctx, { token: 'from-config' }, 'stamp-7')
  const { json } = await callRoute(ctx.routes[0].handler, 'status', {})
  assert.equal(json.value.configured, true)
  assert.equal(json.value.source, 'config')
  assert.equal(json.value.removable, false, 'ключ из конфигурации этим маршрутом не удалить')
})

check('удаление ключа из конфигурации отклонено', async () => {
  const credentials = {
    async resolve() {
      return undefined
    },
    async describe() {
      return { configured: false, writable: true }
    },
    async unset() {
      throw new Error('не должно вызываться')
    },
  }
  const ctx = makeContext({ credentials })
  install(ctx, { token: 'from-config' }, 'stamp-7b')
  const { status, json } = await callRoute(ctx.routes[0].handler, 'key', { clear: true })
  assert.equal(status, 400)
  assert.equal(json.error.code, 'no-store')
  assert.match(json.error.message, /вне хранилища/)
})

check('ключ из окружения: удаление отклонено, состояние читается', async () => {
  const name = 'PROVOD_MANAGEMENT_API_KEY'
  const saved = process.env[name]
  process.env[name] = 'env-key'
  try {
    const credentials = {
      async resolve() {
        return undefined
      },
      async describe() {
        return { configured: false, writable: true }
      },
      async unset() {
        throw new Error('не должно вызываться')
      },
    }
    const ctx = makeContext({ credentials })
    install(ctx, {}, 'stamp-7c')
    const state = await callRoute(ctx.routes[0].handler, 'status', {})
    assert.equal(state.json.value.configured, true)
    assert.equal(state.json.value.source, 'environment')
    assert.equal(state.json.value.removable, false)
    const cleared = await callRoute(ctx.routes[0].handler, 'key', { clear: true })
    assert.equal(cleared.json.error.code, 'no-store')
  } finally {
    if (saved === undefined) delete process.env[name]
    else process.env[name] = saved
  }
})

check('не POST — 405, неизвестная операция — 404', async () => {
  const ctx = makeContext({})
  install(ctx, {}, 'stamp-8')
  const wrong = await callRoute(ctx.routes[0].handler, 'status', {}, 'GET')
  assert.equal(wrong.status, 405)
  assert.equal(wrong.json.error.code, 'method-not-allowed')
  const missing = await callRoute(ctx.routes[0].handler, 'nope', {})
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'unknown-operation')
})

check('битый JSON в теле — bad-request', async () => {
  const ctx = makeContext({})
  install(ctx, {}, 'stamp-9')
  const res = makeResponse()
  const req = {
    method: 'POST',
    url: '/provod-analytics/api/key',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{oops', 'utf8')
    },
  }
  await ctx.routes[0].handler(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(JSON.parse(res.body).error.code, 'bad-request')
})

let passed = 0
for (const { name, run } of checks) {
  try {
    await run()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}
console.log(`\n${passed} проверок пройдено`)
