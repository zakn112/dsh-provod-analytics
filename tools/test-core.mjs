/**
 * Проверки чистой логики `lib/core.mjs` без Cordis и без сети.
 *
 * Запуск: node provod-analytics/tools/test-core.mjs
 */
import assert from 'node:assert/strict'
import {
  aggregate,
  AnalyticsError,
  averageMicros,
  buildGenerationsQueryBody,
  buildHourlyQueryBody,
  buildQueryBody,
  dailySeries,
  decimalToMicros,
  enumerateDays,
  fetchReport,
  forecastFor,
  isValidTimeZone,
  latencyProfile,
  microsFromRow,
  MODEL_METRICS,
  normalizeConfig,
  parseAnalyticsResponse,
  percentile,
  startOfDay,
  startOfMonth,
} from '../lib/core.mjs'

const checks = []
function check(name, run) {
  checks.push({ name, run })
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }
}

/** Ответ аналитики в официальной форме. */
function reportBody(rows, currency = 'RUB') {
  return { data: { data: rows, metadata: { currency, row_count: rows.length, truncated: false } } }
}

check('normalizeConfig: умолчания', () => {
  const settings = normalizeConfig(undefined)
  assert.equal(settings.baseUrl, 'https://api.provod.ai')
  assert.equal(settings.apiKeyName, 'PROVOD_MANAGEMENT_API_KEY')
  assert.equal(settings.token, '')
  assert.equal(settings.timeZone, '')
})

check('normalizeConfig: хвостовой слэш убран', () => {
  const settings = normalizeConfig({ baseUrl: 'https://example.test//', timeZone: 'Europe/Moscow', token: ' k ' })
  assert.equal(settings.baseUrl, 'https://example.test')
  assert.equal(settings.timeZone, 'Europe/Moscow')
  assert.equal(settings.token, 'k')
})

check('decimalToMicros: восемь знаков без потерь', () => {
  assert.equal(decimalToMicros('0.12345678'), 12345678n)
  assert.equal(decimalToMicros('12.5'), 1250000000n)
  assert.equal(decimalToMicros('0'), 0n)
  assert.equal(decimalToMicros('3'), 300000000n)
  assert.equal(decimalToMicros('-0.00000001'), -1n)
  assert.throws(() => decimalToMicros('сто'), AnalyticsError)
})

check('microsFromRow: exact важнее float', () => {
  assert.equal(microsFromRow({ total_usage: 0.3, total_usage_exact: '0.30000001' }), 30000001n)
  assert.equal(microsFromRow({ total_usage: 0.3 }), 30000000n)
  assert.equal(microsFromRow({}), 0n)
})

check('averageMicros: округление до микро', () => {
  assert.equal(averageMicros(100000000n, 3), 33333333n)
  assert.equal(averageMicros(1n, 2), 1n)
  assert.equal(averageMicros(0n, 0), null)
})

check('aggregate: итог, модели и средние', () => {
  const result = aggregate([
    { model: 'model-a', total_usage_exact: '1.50000000', request_count: 10 },
    { model: 'model-a', total_usage_exact: '0.50000000', request_count: 6 },
    { model: 'model-b', total_usage_exact: '2.50000000', request_count: 2 },
    { model: null, total_usage_exact: '0.25000000', request_count: 1 },
  ])
  assert.equal(result.totalMicros, 475000000n)
  assert.equal(result.requests, 19)
  assert.equal(result.models.length, 3)
  assert.equal(result.models[0].model, 'model-b')
  assert.deepEqual(result.models.map((row) => row.model), ['model-b', 'model-a', null])
  const modelA = result.models.find((row) => row.model === 'model-a')
  assert.equal(modelA.micros, 200000000n)
  assert.equal(modelA.requests, 16)
  assert.equal(modelA.averageMicros, 12500000n)
})

check('aggregate: ошибки, токены и взвешенная задержка', () => {
  const result = aggregate([
    {
      model: 'a',
      total_usage_exact: '1.00000000',
      request_count: 10,
      error_count: 1,
      total_prompt_tokens: 1000,
      total_completion_tokens: 500,
      total_reasoning_tokens: 200,
      total_cached_tokens: 400,
      avg_latency: 2,
    },
    {
      model: 'a',
      total_usage_exact: '0.50000000',
      request_count: 5,
      error_count: 0,
      total_prompt_tokens: 500,
      total_completion_tokens: 100,
      total_reasoning_tokens: 0,
      total_cached_tokens: 100,
      avg_latency: 5,
    },
  ])
  const model = result.models[0]
  assert.equal(model.requests, 15)
  assert.equal(model.errors, 1)
  assert.equal(model.promptTokens, 1500)
  assert.equal(model.completionTokens, 600)
  assert.equal(model.reasoningTokens, 200)
  assert.equal(model.cachedTokens, 500)
  // (2 с × 10 запросов + 5 с × 5 запросов) / 15 = 3 с
  assert.equal(model.avgLatency, 3)
  assert.equal(result.errors, 1)
  assert.equal(result.avgLatency, 3)
  assert.equal(result.promptTokens, 1500)
})

check('aggregate: без счётчиков задержка null, а не NaN', () => {
  const result = aggregate([{ model: 'a', total_usage_exact: '1.00000000', request_count: 1 }])
  assert.equal(result.models[0].avgLatency, null)
  assert.equal(result.models[0].promptTokens, 0)
  assert.equal(result.models[0].errors, 0)
})

check('aggregate: пустой период', () => {
  const result = aggregate([])
  assert.equal(result.totalMicros, 0n)
  assert.equal(result.requests, 0)
  assert.deepEqual(result.models, [])
})

check('parseAnalyticsResponse: вложенная форма', () => {
  const parsed = parseAnalyticsResponse(reportBody([{ model: 'x', total_usage_exact: '1.00000000', request_count: 1 }]))
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.currency, 'RUB')
  assert.equal(parsed.truncated, false)
})

check('parseAnalyticsResponse: плоские формы', () => {
  assert.equal(parseAnalyticsResponse({ data: [{ model: 'x' }], metadata: { currency: 'usd' } }).currency, 'USD')
  assert.equal(parseAnalyticsResponse({ rows: [{ model: 'x' }] }).rows.length, 1)
  assert.throws(() => parseAnalyticsResponse({ error: 'nope' }), AnalyticsError)
})

check('границы периодов: Москва без перехода на летнее время', () => {
  const now = new Date('2026-11-20T14:50:20Z')
  assert.equal(startOfDay(now, 'Europe/Moscow').toISOString(), '2026-11-19T21:00:00.000Z')
  assert.equal(startOfMonth(now, 'Europe/Moscow').toISOString(), '2026-10-31T21:00:00.000Z')
})

check('границы периодов: зона Host', () => {
  const now = new Date('2026-11-20T14:50:20Z')
  const dayStart = startOfDay(now, '')
  assert.equal(dayStart.getHours(), 0)
  assert.equal(dayStart.getMinutes(), 0)
  const monthStart = startOfMonth(now, '')
  assert.equal(monthStart.getDate(), 1)
  assert.equal(monthStart.getHours(), 0)
})

check('isValidTimeZone', () => {
  assert.equal(isValidTimeZone('Europe/Moscow'), true)
  assert.equal(isValidTimeZone(''), true)
  assert.equal(isValidTimeZone('Mars/Olympus'), false)
})

check('buildQueryBody: восемь метрик, модель, период', () => {
  const body = buildQueryBody(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-02T00:00:00Z'))
  assert.deepEqual(body.metrics, MODEL_METRICS)
  assert.equal(body.metrics.length, 8, 'предел сервиса — 8 метрик на запрос')
  assert.deepEqual(body.dimensions, ['model'])
  assert.deepEqual(body.time_range, { start: '2026-11-01T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z' })
  assert.equal(body.granularity, undefined)
})

check('buildHourlyQueryBody: часовая гранулярность без измерений', () => {
  const body = buildHourlyQueryBody(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-02T00:00:00Z'))
  assert.equal(body.granularity, 'hour')
  assert.deepEqual(body.dimensions, [])
  assert.deepEqual(body.metrics, ['total_usage', 'request_count'])
})

check('buildGenerationsQueryBody: одна строка на генерацию', () => {
  const body = buildGenerationsQueryBody(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-02T00:00:00Z'))
  assert.deepEqual(body.dimensions, ['model', 'generation_id'])
  assert.equal(body.granularity, undefined)
  assert.equal(body.metrics.length, 3)
  assert.ok(body.metrics.includes('avg_latency'))
  assert.ok(body.metrics.includes('total_completion_tokens'))
  assert.ok(!body.metrics.includes('total_reasoning_tokens'), 'рассуждения входят в вывод — не складываем')
})

check('percentile: линейная интерполяция', () => {
  assert.equal(percentile([1, 2, 3], 0.5), 2)
  assert.equal(percentile([1, 2, 3], 0), 1)
  assert.equal(percentile([1, 2, 3], 1), 3)
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(percentile([10], 0.9), 10)
  assert.equal(percentile([], 0.9), null)
})

check('latencyProfile: медиана, p90 и корзины по объёму ответа', () => {
  const profile = latencyProfile([
    { model: 'a', avg_latency: 1, total_completion_tokens: 100 },
    { model: 'a', avg_latency: 3, total_completion_tokens: 150 },
    { model: 'a', avg_latency: 9, total_completion_tokens: 3000 },
    // Нулевая и отсутствующая задержка не считаются.
    { model: 'a', avg_latency: 0, total_completion_tokens: 100 },
    { model: 'a', total_completion_tokens: 100 },
    { model: 'b', avg_latency: 2, total_completion_tokens: 500 },
  ])
  assert.equal(profile.samples, 4)
  assert.equal(profile.models[0].model, 'a', 'самая медленная по медиане — первой')
  const a = profile.models[0]
  assert.equal(a.samples, 3)
  assert.equal(a.medianLatency, 3)
  assert.equal(a.p90Latency, 7.8)
  const short = a.buckets.find((bucket) => bucket.key === 'short')
  assert.equal(short.count, 2)
  assert.equal(short.medianLatency, 2)
  const long = a.buckets.find((bucket) => bucket.key === 'long')
  assert.equal(long.count, 1)
  assert.equal(long.medianLatency, 9)
  const huge = a.buckets.find((bucket) => bucket.key === 'huge')
  assert.equal(huge.count, 0)
  assert.equal(huge.medianLatency, null)
  assert.equal(profile.models[1].model, 'b')
})

check('enumerateDays: от первого числа до сегодня', () => {
  const now = new Date('2026-11-20T14:50:20Z')
  const days = enumerateDays(startOfMonth(now, 'Europe/Moscow'), now, 'Europe/Moscow')
  assert.equal(days.length, 20)
  assert.equal(days[0].date, '2026-11-01')
  assert.equal(days[19].date, '2026-11-20')
})

check('dailySeries: часовые строки складываются в местные сутки', () => {
  const now = new Date('2026-11-20T14:50:20Z')
  const monthStart = startOfMonth(now, 'Europe/Moscow')
  const days = dailySeries(
    [
      // 23:00 UTC 19 ноября — это 02:00 20 ноября по Москве.
      { date__hour: '2026-11-19T23:00:00.000Z', total_usage_exact: '0.10000000', request_count: 1 },
      // 20:00 UTC 19 ноября — это 23:00 19 ноября.
      { date__hour: '2026-11-19T20:00:00.000Z', total_usage_exact: '0.20000000', request_count: 2 },
      // Строка вне месяца игнорируется.
      { date__hour: '2026-10-01T10:00:00.000Z', total_usage_exact: '9.00000000', request_count: 9 },
      // Строка без времени не ломает разбор.
      { total_usage_exact: '7.00000000', request_count: 7 },
    ],
    monthStart,
    now,
    'Europe/Moscow',
  )
  const byDate = new Map(days.map((day) => [day.date, day]))
  assert.equal(days.length, 20)
  assert.equal(byDate.get('2026-11-20').micros, 10000000n)
  assert.equal(byDate.get('2026-11-20').requests, 1)
  assert.equal(byDate.get('2026-11-19').micros, 20000000n)
  assert.equal(byDate.get('2026-11-01').micros, 0n)
})

check('forecastFor: прогноз по темпу с начала месяца', () => {
  const now = new Date('2026-11-20T14:50:20Z')
  const monthStart = startOfMonth(now, 'Europe/Moscow')
  const forecast = forecastFor(400000000n, monthStart, now, 'Europe/Moscow')
  assert.equal(forecast.daysInMonth, 30)
  assert.ok(forecast.micros !== null)
  // 4 ₽ × 30 / 19,7 суток ≈ 6,1 ₽
  const value = Number(forecast.micros)
  assert.ok(value > 500000000 && value < 700000000, `прогноз ${value}`)
  assert.ok(forecast.elapsedDays > 19 && forecast.elapsedDays < 20)
})

check('forecastFor: в первые сутки прогноза нет', () => {
  const monthStart = new Date('2026-11-01T00:00:00+03:00')
  const forecast = forecastFor(100000000n, monthStart, new Date('2026-11-01T12:00:00+03:00'), 'Europe/Moscow')
  assert.equal(forecast.micros, null)
  assert.equal(forecast.daysInMonth, 30)
})

check('fetchReport: четыре запроса, дневная полоса, прогноз и профиль задержек', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url, body })
    if (body.granularity === 'hour') {
      return fakeResponse(
        200,
        reportBody([
          { date__hour: '2026-11-20T09:00:00.000Z', total_usage_exact: '0.10000000', request_count: 1 },
          { date__hour: '2026-11-19T09:00:00.000Z', total_usage_exact: '0.20000000', request_count: 2 },
        ]),
      )
    }
    if (Array.isArray(body.dimensions) && body.dimensions.includes('generation_id')) {
      return fakeResponse(
        200,
        reportBody([
          { model: 'model-a', generation_id: 'gen-1', avg_latency: 2, total_completion_tokens: 400 },
          { model: 'model-a', generation_id: 'gen-2', avg_latency: 6, total_completion_tokens: 5000 },
          { model: 'model-b', generation_id: 'gen-3', avg_latency: 1.5, total_completion_tokens: 300 },
        ]),
      )
    }
    const rows =
      body.time_range.start === '2026-11-19T21:00:00.000Z'
        ? [{ model: 'model-a', total_usage_exact: '0.40000000', request_count: 4 }]
        : [
            { model: 'model-a', total_usage_exact: '3.00000000', request_count: 30 },
            { model: 'model-b', total_usage_exact: '1.00000000', request_count: 10 },
          ]
    return fakeResponse(200, reportBody(rows))
  }
  const report = await (async () => {
    const original = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      return await fetchReport({
        baseUrl: 'https://api.test',
        token: 'key',
        now: new Date('2026-11-20T14:50:20Z'),
        timeZone: 'Europe/Moscow',
      })
    } finally {
      globalThis.fetch = original
    }
  })()
  assert.equal(calls.length, 4)
  assert.equal(calls[0].url, 'https://api.test/v1/analytics/query')
  assert.equal(calls[2].body.granularity, 'hour')
  assert.ok(calls[3].body.dimensions.includes('generation_id'))
  assert.equal(report.currency, 'RUB')
  assert.equal(report.periods.today.totalMicros, '40000000')
  assert.equal(report.periods.today.requests, 4)
  assert.equal(report.periods.month.totalMicros, '400000000')
  assert.equal(report.periods.month.models.length, 2)
  assert.equal(report.periods.month.models[0].model, 'model-a')
  assert.equal(report.periods.month.models[0].averageMicros, '10000000')
  assert.equal(report.ranges.today.start, '2026-11-19T21:00:00.000Z')
  assert.equal(report.ranges.month.start, '2026-10-31T21:00:00.000Z')
  const days = new Map(report.daily.days.map((day) => [day.date, day]))
  assert.equal(report.daily.days.length, 20)
  assert.equal(days.get('2026-11-20').micros, '10000000')
  assert.equal(days.get('2026-11-19').micros, '20000000')
  assert.ok(report.forecast.micros !== null)
  assert.equal(report.forecast.daysInMonth, 30)
  assert.equal(report.latency.samples, 3)
  assert.equal(report.latency.models.length, 2)
  assert.equal(report.latency.models[0].model, 'model-a')
  assert.equal(report.latency.models[0].medianLatency, 4)
  assert.equal(report.latency.models[0].p90Latency, 5.6)
  assert.equal(report.latency.models[0].buckets.find((bucket) => bucket.key === 'huge').count, 1)
})

check('fetchReport: ключ не принят — код unauthorized', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => fakeResponse(401, { error: { code: 'invalid_api_key', message: 'Invalid API key' } })
  try {
    await assert.rejects(
      () => fetchReport({ baseUrl: 'https://api.test', token: 'bad', now: new Date() }),
      (error) => error instanceof AnalyticsError && error.code === 'unauthorized' && /Invalid API key/.test(error.message),
    )
  } finally {
    globalThis.fetch = original
  }
})

check('fetchReport: 503 становится unavailable', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => fakeResponse(503, { message: 'Analytics temporarily unavailable' })
  try {
    await assert.rejects(
      () => fetchReport({ baseUrl: 'https://api.test', token: 'k', now: new Date() }),
      (error) => error instanceof AnalyticsError && error.code === 'unavailable',
    )
  } finally {
    globalThis.fetch = original
  }
})

check('fetchReport: один повтор после 429', async () => {
  const original = globalThis.fetch
  let count = 0
  globalThis.fetch = async () => {
    count += 1
    if (count === 1) return fakeResponse(429, { message: 'slow down' })
    return fakeResponse(200, reportBody([{ model: 'x', total_usage_exact: '1.00000000', request_count: 1 }]))
  }
  try {
    const report = await fetchReport({ baseUrl: 'https://api.test', token: 'k', now: new Date() })
    assert.equal(count, 5, 'четыре запроса плюс один повтор')
    assert.equal(report.periods.today.totalMicros, '100000000')
  } finally {
    globalThis.fetch = original
  }
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
