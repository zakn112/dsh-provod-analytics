/**
 * Расходы Provod — чистая логика без Cordis и без HTTP-сервера.
 *
 * Здесь всё, что можно проверить без запущенного Host: границы «сегодня» и
 * «с начала месяца» в нужной зоне, точная арифметика сумм (1e-8 валюты в
 * BigInt, без float-ошибок), тело запроса к `POST /v1/analytics/query`,
 * разбор ответа и сведение строк по моделям.
 *
 * Денежные значения хранятся в «микро»: 1 валюта = 100000000 микро.
 * Строки API (`total_usage_exact`, 8 знаков) переводятся в микро без потерь.
 */

export const DEFAULT_BASE_URL = 'https://api.provod.ai'
export const DEFAULT_KEY_NAME = 'PROVOD_MANAGEMENT_API_KEY'
export const DEFAULT_BALANCE_KEY_NAME = 'PROVOD_API_KEY'

const MICROS_PER_UNIT = 100000000n
const MAX_MODEL_ROWS = 1000
const MAX_HOUR_ROWS = 1000
const MAX_GENERATION_ROWS = 1000
const QUERY_PATH = '/v1/analytics/query'
const BALANCE_PATH = '/v1/balance'
const CREDITS_PATH = '/v1/credits'

/**
 * Корзины по объёму ответа. Длительность почти линейна числу выходных
 * токенов, поэтому сравнение «на одинаковую задачу» делается внутри корзины,
 * а не по общему среднему.
 */
export const LATENCY_BUCKETS = [
  { key: 'short', max: 200 },
  { key: 'medium', max: 1000 },
  { key: 'long', max: 4000 },
  { key: 'huge', max: Number.POSITIVE_INFINITY },
]

/**
 * Ровно восемь метрик — предел одного запроса. Кроме денег и числа запросов
 * здесь ошибки (они тоже платные) и токены: по ним считается структура
 * стоимости — доля кеша, рассуждения, цена за миллион токенов.
 */
export const MODEL_METRICS = [
  'total_usage',
  'request_count',
  'error_count',
  'total_prompt_tokens',
  'total_completion_tokens',
  'total_reasoning_tokens',
  'total_cached_tokens',
  'avg_latency',
]

/** Ошибка с машинным кодом, который клиент переводит в подпись. */
export class AnalyticsError extends Error {
  /**
   * @param {string} code машинный код
   * @param {string} message текст для журнала Host
   * @param {{ status?: number, details?: unknown }} [options] HTTP-статус и подробности
   */
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'AnalyticsError'
    this.code = code
    this.status = options.status
    this.details = options.details
  }
}

/**
 * Свести конфигурацию строки плагина к известным полям с умолчаниями.
 * @param {unknown} config значение `config` строки Loader
 * @returns {{ baseUrl: string, apiKeyName: string, balanceKeyName: string, token: string, timeZone: string }}
 */
export function normalizeConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
  const apiKeyName = typeof raw.apiKeyName === 'string' ? raw.apiKeyName.trim() : ''
  const balanceKeyName = typeof raw.balanceKeyName === 'string' ? raw.balanceKeyName.trim() : ''
  return {
    baseUrl: (baseUrl === '' ? DEFAULT_BASE_URL : baseUrl).replace(/\/+$/u, ''),
    apiKeyName: apiKeyName === '' ? DEFAULT_KEY_NAME : apiKeyName,
    balanceKeyName: balanceKeyName === '' ? DEFAULT_BALANCE_KEY_NAME : balanceKeyName,
    token: typeof raw.token === 'string' ? raw.token.trim() : '',
    timeZone: typeof raw.timeZone === 'string' ? raw.timeZone.trim() : '',
  }
}

/**
 * Разобрать десятичную строку в микро без потери точности.
 * @param {string} text например `"0.12345678"`
 * @returns {bigint}
 */
export function decimalToMicros(text) {
  const cleaned = String(text).trim()
  if (cleaned === '' || !/^[+-]?\d*(?:\.\d*)?$/u.test(cleaned)) {
    throw new AnalyticsError('shape', `Не удалось прочитать сумму «${cleaned}»`)
  }
  const negative = cleaned.startsWith('-')
  const body = cleaned.replace(/^[+-]/u, '')
  const dot = body.indexOf('.')
  const whole = dot === -1 ? body : body.slice(0, dot)
  const fraction = dot === -1 ? '' : body.slice(dot + 1)
  const digits = (fraction + '00000000').slice(0, 8).padEnd(8, '0')
  const value = BigInt(whole === '' ? '0' : whole) * MICROS_PER_UNIT + BigInt(digits)
  return negative ? -value : value
}

/**
 * Достать точную сумму строки отчёта в микро.
 * @param {Record<string, unknown>} row одна строка ответа аналитики
 * @returns {bigint}
 */
export function microsFromRow(row) {
  const exact = row?.total_usage_exact
  if (typeof exact === 'string' && exact.trim() !== '') return decimalToMicros(exact)
  if (typeof exact === 'number' && Number.isFinite(exact)) return decimalToMicros(String(exact))
  const value = row?.total_usage
  if (typeof value === 'string' && value.trim() !== '') return decimalToMicros(value)
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0n
  return BigInt(Math.round(number * Number(MICROS_PER_UNIT)))
}

/**
 * Целое неотрицательное число из строки отчёта (счётчики токенов и ошибок).
 * @param {Record<string, unknown>} row одна строка ответа аналитики
 * @param {string} field имя поля
 * @returns {number}
 */
function counterFromRow(row, field) {
  const value = row?.[field]
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

/** Число с плавающей точкой из строки отчёта; отсутствие — null. */
function floatFromRow(row, field) {
  const value = row?.[field]
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Число завершённых запросов строки отчёта.
 * @param {Record<string, unknown>} row одна строка ответа аналитики
 * @returns {number}
 */
export function requestsFromRow(row) {
  return counterFromRow(row, 'request_count')
}

/**
 * Средняя стоимость обращения в микро: сумма, делённая на число запросов.
 * @param {bigint} micros сумма периода
 * @param {number} requests число запросов
 * @returns {bigint | null} null, когда запросов нет
 */
export function averageMicros(micros, requests) {
  if (!(requests > 0)) return null
  const divisor = BigInt(requests)
  return (micros * 2n + divisor) / (divisor * 2n)
}

/** Части настенных часов в заданной зоне. */
function zoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  /** @type {Record<string, string>} */
  const parts = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** Смещение зоны относительно UTC в миллисекундах на момент `timestamp`. */
function zoneOffsetMs(timestamp, timeZone) {
  const parts = zoneParts(new Date(timestamp), timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - timestamp
}

/** Мгновение UTC, когда в зоне наступает указанное настенное время. */
function zonedInstant(year, monthIndex, day, timeZone) {
  const wall = Date.UTC(year, monthIndex, day, 0, 0, 0)
  let instant = wall - zoneOffsetMs(wall, timeZone)
  const corrected = zoneOffsetMs(instant, timeZone)
  if (corrected !== zoneOffsetMs(wall, timeZone)) instant = wall - corrected
  return new Date(instant)
}

/**
 * Начало текущих суток: в зоне `timeZone`, иначе в зоне Host.
 * @param {Date} now текущий момент
 * @param {string} [timeZone] IANA-зона, например `Europe/Moscow`
 * @returns {Date}
 */
export function startOfDay(now, timeZone) {
  if (timeZone === undefined || timeZone === '') {
    const local = new Date(now.getTime())
    local.setHours(0, 0, 0, 0)
    return local
  }
  const parts = zoneParts(now, timeZone)
  return zonedInstant(parts.year, parts.month - 1, parts.day, timeZone)
}

/**
 * Начало текущего месяца: в зоне `timeZone`, иначе в зоне Host.
 * @param {Date} now текущий момент
 * @param {string} [timeZone] IANA-зона
 * @returns {Date}
 */
export function startOfMonth(now, timeZone) {
  if (timeZone === undefined || timeZone === '') {
    const local = new Date(now.getTime())
    local.setDate(1)
    local.setHours(0, 0, 0, 0)
    return local
  }
  const parts = zoneParts(now, timeZone)
  return zonedInstant(parts.year, parts.month - 1, 1, timeZone)
}

/**
 * Проверить зону до первого запроса, чтобы опечатка в конфигурации была видна сразу.
 * @param {string} timeZone IANA-зона или пустая строка
 * @returns {boolean} принимает ли её Intl
 */
export function isValidTimeZone(timeZone) {
  if (timeZone === '') return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

/**
 * Тело запроса аналитики: строки по моделям за один период.
 * @param {Date} start начало периода включительно
 * @param {Date} end конец периода исключительно
 * @returns {Record<string, unknown>}
 */
export function buildQueryBody(start, end) {
  return {
    metrics: MODEL_METRICS,
    dimensions: ['model'],
    time_range: { start: start.toISOString(), end: end.toISOString() },
    limit: MAX_MODEL_ROWS,
  }
}

/**
 * Тело запроса по отдельным генерациям: одна строка — один запрос, поэтому
 * из них считаются медиана, хвост и разбивка по объёму ответа.
 *
 * Токены рассуждений отдельно не запрашиваются: они могут входить в
 * оплачиваемый вывод, и складывать категории повторно нельзя — корзины
 * считаются по `total_completion_tokens`.
 * @param {Date} start начало периода включительно
 * @param {Date} end конец периода исключительно
 * @returns {Record<string, unknown>}
 */
export function buildGenerationsQueryBody(start, end) {
  return {
    metrics: ['avg_latency', 'total_completion_tokens', 'error_count'],
    dimensions: ['model', 'generation_id'],
    time_range: { start: start.toISOString(), end: end.toISOString() },
    limit: MAX_GENERATION_ROWS,
  }
}

/**
 * Тело запроса дневной полосы. Гранулярность — час, а не сутки: сервис режет
 * время по UTC, и только почасовые строки можно точно сложить в местные сутки,
 * совпадающие с границами «сегодня» и «с начала месяца».
 * @param {Date} start начало периода включительно
 * @param {Date} end конец периода исключительно
 * @returns {Record<string, unknown>}
 */
export function buildHourlyQueryBody(start, end) {
  return {
    metrics: ['total_usage', 'request_count'],
    dimensions: [],
    granularity: 'hour',
    time_range: { start: start.toISOString(), end: end.toISOString() },
    limit: MAX_HOUR_ROWS,
  }
}

/**
 * Достать строки и валюту из ответа `POST /v1/analytics/query`.
 *
 * Официальная форма — `{ data: { data: [...], metadata: { currency } } }`;
 * плоские варианты принимаются, чтобы панель пережила смену обёртки.
 * @param {unknown} payload разобранный JSON ответа
 * @returns {{ rows: Array<Record<string, unknown>>, currency: string | null, truncated: boolean }}
 */
export function parseAnalyticsResponse(payload) {
  const body = payload !== null && typeof payload === 'object' ? /** @type {Record<string, any>} */ (payload) : null
  if (body === null) throw new AnalyticsError('shape', 'Ответ аналитики не является объектом')

  let rows
  let metadata = {}
  if (Array.isArray(body.data)) {
    rows = body.data
    metadata = body.metadata ?? {}
  } else if (body.data !== null && typeof body.data === 'object' && Array.isArray(body.data.data)) {
    rows = body.data.data
    metadata = body.data.metadata ?? body.metadata ?? {}
  } else if (Array.isArray(body.rows)) {
    rows = body.rows
    metadata = body.metadata ?? {}
  } else if (Array.isArray(body.results)) {
    rows = body.results
    metadata = body.metadata ?? {}
  } else {
    const keys = Object.keys(body).slice(0, 6).join(', ')
    throw new AnalyticsError('shape', `В ответе аналитики нет массива строк (поля: ${keys})`)
  }

  const currency = typeof metadata.currency === 'string' && metadata.currency.trim() !== '' ? metadata.currency.trim().toUpperCase() : null
  return { rows: rows.filter((row) => row !== null && typeof row === 'object'), currency, truncated: metadata.truncated === true }
}

/** Счётчики одного итога: деньги, запросы, ошибки, токены и вес задержки. */
function emptyTotals() {
  return {
    micros: 0n,
    requests: 0,
    errors: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    latencyWeighted: 0,
    latencyWeight: 0,
  }
}

/** Прибавить строку отчёта к счётчикам. */
function addRow(totals, row) {
  const count = requestsFromRow(row)
  totals.micros += microsFromRow(row)
  totals.requests += count
  totals.errors += counterFromRow(row, 'error_count')
  totals.promptTokens += counterFromRow(row, 'total_prompt_tokens')
  totals.completionTokens += counterFromRow(row, 'total_completion_tokens')
  totals.reasoningTokens += counterFromRow(row, 'total_reasoning_tokens')
  totals.cachedTokens += counterFromRow(row, 'total_cached_tokens')
  const latency = floatFromRow(row, 'avg_latency')
  if (latency !== null && latency >= 0 && count > 0) {
    // `avg_latency` — средняя по строке, поэтому складывать её нельзя:
    // итоговая средняя взвешивается числом запросов.
    totals.latencyWeighted += latency * count
    totals.latencyWeight += count
  }
}

/** Превратить счётчики в результат с округлённой средней задержкой. */
function finishTotals(totals) {
  return {
    micros: totals.micros,
    requests: totals.requests,
    errors: totals.errors,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    reasoningTokens: totals.reasoningTokens,
    cachedTokens: totals.cachedTokens,
    avgLatency:
      totals.latencyWeight > 0 ? Math.round((totals.latencyWeighted / totals.latencyWeight) * 1000) / 1000 : null,
  }
}

/**
 * Свести строки одного периода в итог и разбивку по моделям.
 * @param {Array<Record<string, unknown>>} rows строки ответа
 * @returns {{ totalMicros: bigint, requests: number, errors: number, promptTokens: number,
 *   completionTokens: number, reasoningTokens: number, cachedTokens: number,
 *   avgLatency: number | null, models: Array<Record<string, unknown>> }}
 */
export function aggregate(rows) {
  /** @type {Map<string, Record<string, any>>} */
  const byModel = new Map()
  const total = emptyTotals()
  for (const row of rows) {
    const model = typeof row.model === 'string' && row.model.trim() !== '' ? row.model : null
    const key = model === null ? '\u0000' : model
    const entry = byModel.get(key) ?? { model, ...emptyTotals() }
    addRow(entry, row)
    addRow(total, row)
    byModel.set(key, entry)
  }

  const models = [...byModel.values()]
    .map((entry) => ({
      model: entry.model,
      ...finishTotals(entry),
      averageMicros: averageMicros(entry.micros, entry.requests),
    }))
    .sort((left, right) => {
      if (left.micros === right.micros) return String(left.model ?? '').localeCompare(String(right.model ?? ''))
      return left.micros < right.micros ? 1 : -1
    })

  const totals = finishTotals(total)
  return {
    totalMicros: totals.micros,
    requests: totals.requests,
    errors: totals.errors,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    reasoningTokens: totals.reasoningTokens,
    cachedTokens: totals.cachedTokens,
    avgLatency: totals.avgLatency,
    models,
  }
}

/**
 * Отправить одно тело запроса в `POST /v1/analytics/query` и разобрать ответ.
 * @param {object} input параметры запроса
 * @param {string} input.baseUrl адрес API без хвостового слэша
 * @param {string} input.token управляющий ключ
 * @param {Record<string, unknown>} input.body тело запроса
 * @param {typeof fetch} [input.fetchImpl] подмена транспорта для тестов
 * @param {number} [input.timeoutMs] предел ожидания
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, currency: string | null, truncated: boolean }>}
 */
async function postQuery({ baseUrl, token, body, fetchImpl = fetch, timeoutMs = 20000 }) {
  const url = `${baseUrl}${QUERY_PATH}`
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error !== null && typeof error === 'object' && /** @type {any} */ (error).name === 'TimeoutError') {
      throw new AnalyticsError('timeout', 'Сервис аналитики не ответил за 20 секунд')
    }
    throw new AnalyticsError('network', `Сеть недоступна: ${message}`)
  }

  const text = await response.text().catch(() => '')
  let payload
  try {
    payload = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    payload = null
  }

  if (!response.ok) {
    const upstream = upstreamMessage(payload)
    const mapped = statusError(response.status)
    throw new AnalyticsError(mapped.code, upstream === null ? mapped.message : `${mapped.message} ${upstream}`, {
      status: response.status,
    })
  }
  if (payload === null) throw new AnalyticsError('shape', 'Ответ аналитики не разобран как JSON')

  return parseAnalyticsResponse(payload)
}

/**
 * Запрос строк по моделям за период.
 * @param {object} input параметры запроса
 * @param {string} input.baseUrl адрес API
 * @param {string} input.token управляющий ключ
 * @param {Date} input.start начало периода
 * @param {Date} input.end конец периода
 * @param {typeof fetch} [input.fetchImpl] подмена транспорта для тестов
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, currency: string | null, truncated: boolean }>}
 */
export function queryPeriod({ baseUrl, token, start, end, fetchImpl = fetch, timeoutMs = 20000 }) {
  return postQuery({ baseUrl, token, body: buildQueryBody(start, end), fetchImpl, timeoutMs })
}

/**
 * Запрос почасовых строк за период: из них складывается дневная полоса.
 * @param {object} input параметры запроса
 * @param {string} input.baseUrl адрес API
 * @param {string} input.token управляющий ключ
 * @param {Date} input.start начало периода
 * @param {Date} input.end конец периода
 * @param {typeof fetch} [input.fetchImpl] подмена транспорта для тестов
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, currency: string | null, truncated: boolean }>}
 */
export function queryHourly({ baseUrl, token, start, end, fetchImpl = fetch, timeoutMs = 20000 }) {
  return postQuery({ baseUrl, token, body: buildHourlyQueryBody(start, end), fetchImpl, timeoutMs })
}

/**
 * Запрос по отдельным генерациям за период.
 * @param {object} input параметры запроса
 * @param {string} input.baseUrl адрес API
 * @param {string} input.token управляющий ключ
 * @param {Date} input.start начало периода
 * @param {Date} input.end конец периода
 * @param {typeof fetch} [input.fetchImpl] подмена транспорта для тестов
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, currency: string | null, truncated: boolean }>}
 */
export function queryGenerations({ baseUrl, token, start, end, fetchImpl = fetch, timeoutMs = 20000 }) {
  return postQuery({ baseUrl, token, body: buildGenerationsQueryBody(start, end), fetchImpl, timeoutMs })
}

/**
 * Значение баланса в микро: сервис отдаёт число в валюте, а панель считает
 * в микро, как и все остальные суммы.
 * @param {unknown} value `availableBalance` или `reservedBalance`
 * @returns {bigint | null} null, когда поля нет
 */
function balanceMicros(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return decimalToMicros(String(value))
  if (typeof value === 'string' && value.trim() !== '') return decimalToMicros(value.trim())
  return null
}

/**
 * GET-ответ сервиса как JSON; отказ транспорта и статуса — в общий домен.
 * @param {object} input адрес, ключ, транспорт, предел и название части отчёта
 * @param {string} input.url полный адрес
 * @param {string} input.token ключ
 * @param {typeof fetch} input.fetchImpl транспорт
 * @param {number} input.timeoutMs предел ожидания
 * @param {string} input.label название части отчёта для текста ошибки
 * @returns {Promise<unknown>} разобранный JSON
 */
async function getJson({ url, token, fetchImpl, timeoutMs, label }) {
  let response
  try {
    response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error !== null && typeof error === 'object' && /** @type {any} */ (error).name === 'TimeoutError') {
      throw new AnalyticsError('timeout', `Сервис ${label} не ответил за 20 секунд`)
    }
    throw new AnalyticsError('network', `Сеть недоступна: ${message}`)
  }

  const text = await response.text().catch(() => '')
  let payload
  try {
    payload = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    payload = null
  }

  if (!response.ok) {
    const upstream = upstreamMessage(payload)
    const mapped = statusError(response.status)
    throw new AnalyticsError(mapped.code, upstream === null ? mapped.message : `${mapped.message} ${upstream}`, {
      status: response.status,
    })
  }
  if (payload === null) throw new AnalyticsError('shape', `Ответ ${label} не разобран как JSON`)
  return payload
}

/**
 * Тело ответа: сам объект или обёртка `{ data: ... }`.
 * @param {unknown} payload разобранный JSON
 * @returns {Record<string, any>}
 */
function payloadBody(payload) {
  const object = payload !== null && typeof payload === 'object' ? /** @type {Record<string, any>} */ (payload) : null
  if (object === null) throw new AnalyticsError('shape', 'Ответ сервиса не является объектом')
  const data = object.data
  return data !== null && typeof data === 'object' ? /** @type {Record<string, any>} */ (data) : object
}

/**
 * Точный остаток на счёте рабочего пространства: `GET /v1/balance`.
 *
 * Эндпоинт относится к inference-API: ему нужен **обычный** API-ключ, не
 * управляющий. `availableBalance` уже учитывает резерв, `reservedBalance`
 * показывается отдельно. Валюта — та, что вернуло окружение; пересчитывать
 * её нельзя.
 * @param {object} input параметры запроса
 * @param {string} input.baseUrl адрес API без хвостового слэша
 * @param {string} input.token обычный API-ключ
 * @param {typeof fetch} [input.fetchImpl] подмена транспорта для тестов
 * @param {number} [input.timeoutMs] предел ожидания
 * @returns {Promise<{ availableMicros: string, reservedMicros: string | null, currency: string | null, approximate: boolean }>}
 */
export async function fetchBalance({ baseUrl, token, fetchImpl = fetch, timeoutMs = 20000 }) {
  const payload = await getJson({ url: `${baseUrl}${BALANCE_PATH}`, token, fetchImpl, timeoutMs, label: 'баланса' })
  const body = payloadBody(payload)
  const available = balanceMicros(body.availableBalance)
  if (available === null) throw new AnalyticsError('shape', 'В ответе баланса нет availableBalance')
  const reserved = balanceMicros(body.reservedBalance)
  const currency =
    typeof body.currency === 'string' && body.currency.trim() !== '' ? body.currency.trim().toUpperCase() : null
  return {
    availableMicros: available.toString(),
    reservedMicros: reserved === null ? null : reserved.toString(),
    currency,
    approximate: false,
  }
}

/**
 * Пополнения и расходы рабочего пространства: `GET /v1/credits`.
 *
 * Доступен управляющему ключу. Разность `total_credits − total_usage` — не
 * доступный баланс: она не учитывает резервы, возвраты и другие операции,
 * поэтому результат помечен `approximate`.
 * @param {object} input параметры запроса
 * @param {string} input.baseUrl адрес API без хвостового слэша
 * @param {string} input.token управляющий ключ
 * @param {typeof fetch} [input.fetchImpl] подмена транспорта для тестов
 * @param {number} [input.timeoutMs] предел ожидания
 * @returns {Promise<{ availableMicros: string, reservedMicros: null, currency: string, approximate: boolean }>}
 */
export async function fetchCredits({ baseUrl, token, fetchImpl = fetch, timeoutMs = 20000 }) {
  const payload = await getJson({ url: `${baseUrl}${CREDITS_PATH}`, token, fetchImpl, timeoutMs, label: 'пополнений' })
  const body = payloadBody(payload)
  const credits = balanceMicros(body.total_credits)
  const usage = balanceMicros(body.total_usage)
  if (credits === null || usage === null) {
    throw new AnalyticsError('shape', 'В ответе пополнений нет total_credits или total_usage')
  }
  return {
    availableMicros: (credits - usage).toString(),
    reservedMicros: null,
    currency: 'RUB',
    approximate: true,
  }
}

/** Сообщение об ошибке из тела ответа, если оно есть. */
function upstreamMessage(payload) {
  if (payload === null || typeof payload !== 'object') return null
  const body = /** @type {Record<string, any>} */ (payload)
  if (typeof body.message === 'string' && body.message.trim() !== '') return body.message.trim().slice(0, 240)
  if (typeof body.error === 'string' && body.error.trim() !== '') return body.error.trim().slice(0, 240)
  if (body.error !== null && typeof body.error === 'object' && typeof body.error.message === 'string') {
    return body.error.message.trim().slice(0, 240)
  }
  return null
}

/** Код и текст ошибки по HTTP-статусу ответа аналитики. */
function statusError(status) {
  if (status === 401) return { code: 'unauthorized', message: 'Ключ не принят: он неверный, отключён или истёк.' }
  if (status === 403) return { code: 'forbidden', message: 'Ключ не подходит: нужен управляющий ключ рабочего пространства.' }
  if (status === 400) return { code: 'bad-request', message: 'Сервис отклонил параметры запроса.' }
  if (status === 429) return { code: 'rate-limited', message: 'Слишком часто: у аналитики лимит 2 запроса в секунду и 30 в минуту.' }
  if (status === 503) return { code: 'unavailable', message: 'Аналитика временно недоступна.' }
  return { code: 'upstream', message: `Сервис ответил ${status}.` }
}

/** Пауза между повторами, мс. */
function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

/** Календарные части даты в зоне отчёта, иначе в зоне Host. */
function dayParts(date, timeZone) {
  if (timeZone === undefined || timeZone === '') {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
  }
  const parts = zoneParts(date, timeZone)
  return { year: parts.year, month: parts.month, day: parts.day }
}

/** Двузначное число с ведущим нулём. */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Ключ суток `YYYY-MM-DD` в зоне отчёта. */
function dayKeyOf(date, timeZone) {
  const parts = dayParts(date, timeZone)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

/**
 * Все сутки от начала месяца до `now` включительно, по порядку, с нулями.
 * @param {Date} monthStart начало месяца
 * @param {Date} now текущий момент
 * @param {string} [timeZone] IANA-зона
 * @returns {Array<{ date: string, micros: bigint, requests: number }>}
 */
export function enumerateDays(monthStart, now, timeZone) {
  const first = dayParts(monthStart, timeZone)
  const last = dayParts(now, timeZone)
  const days = []
  let cursor = Date.UTC(first.year, first.month - 1, first.day)
  const end = Date.UTC(last.year, last.month - 1, last.day)
  let guard = 0
  while (cursor <= end && guard < 400) {
    const date = new Date(cursor)
    days.push({
      date: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
      micros: 0n,
      requests: 0,
    })
    cursor += 86400000
    guard += 1
  }
  return days
}

/**
 * Сложить почасовые строки ответа в местные сутки.
 *
 * Сервис режет время по UTC, поэтому суточная гранулярность не совпала бы с
 * границами «сегодня» и «с начала месяца». Часовые строки складываются в те
 * же сутки, что и карточки.
 * @param {Array<Record<string, unknown>>} rows строки с `date__hour`
 * @param {Date} monthStart начало месяца
 * @param {Date} now текущий момент
 * @param {string} [timeZone] IANA-зона
 * @returns {Array<{ date: string, micros: bigint, requests: number }>}
 */
export function dailySeries(rows, monthStart, now, timeZone) {
  const days = enumerateDays(monthStart, now, timeZone)
  if (days.length === 0) return days
  const byKey = new Map(days.map((day) => [day.date, day]))
  for (const row of rows) {
    const stamp = row.date__hour ?? row.date__day
    if (typeof stamp !== 'string') continue
    const date = new Date(stamp)
    if (Number.isNaN(date.getTime())) continue
    const bucket = byKey.get(dayKeyOf(date, timeZone))
    if (bucket === undefined) continue
    bucket.micros += microsFromRow(row)
    bucket.requests += requestsFromRow(row)
  }
  return days
}

/**
 * Прогноз расходов до конца месяца по темпу с начала месяца.
 * @param {bigint} monthMicros расходы с начала месяца
 * @param {Date} monthStart начало месяца
 * @param {Date} now текущий момент
 * @param {string} [timeZone] IANA-зона
 * @returns {{ micros: string | null, daysInMonth: number, elapsedDays: number }}
 */
export function forecastFor(monthMicros, monthStart, now, timeZone) {
  const parts = dayParts(now, timeZone)
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()
  const elapsedDays = (now.getTime() - monthStart.getTime()) / 86400000
  const rounded = Math.round(Math.max(0, elapsedDays) * 10) / 10
  if (!(daysInMonth > 0)) return { micros: null, daysInMonth: 0, elapsedDays: rounded }
  // В первые двое суток темп ещё не показатель: одна крупная трата даёт
  // прогноз в разы больше реального.
  if (!(elapsedDays >= 2)) return { micros: null, daysInMonth, elapsedDays: rounded }
  const projected = (Number(monthMicros) * daysInMonth) / elapsedDays
  return {
    micros: Number.isFinite(projected) ? BigInt(Math.round(projected)).toString() : null,
    daysInMonth,
    elapsedDays: rounded,
  }
}

/**
 * Квантиль по уже отсортированному массиву (линейная интерполяция).
 * @param {number[]} sorted значения по возрастанию
 * @param {number} q доля от 0 до 1
 * @returns {number | null}
 */
export function percentile(sorted, q) {
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.ceil(position)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

/** Округлить до тысячных; null остаётся null. */
function round3(value) {
  return value === null ? null : Math.round(value * 1000) / 1000
}

/**
 * Профиль задержек по моделям из строк «одна генерация — одна строка».
 *
 * Среднее время ответа здесь не годится: один зависший запрос сдвигает его,
 * а длина ответа определяет длительность сильнее модели. Поэтому считаются
 * медиана и p90, а сравнение моделей — внутри корзин по объёму ответа.
 * @param {Array<Record<string, unknown>>} rows строки с `avg_latency` и моделью
 * @returns {{ samples: number, models: Array<object> }}
 */
export function latencyProfile(rows) {
  /** @type {Map<string, { model: string | null, latencies: number[], buckets: number[][] }>} */
  const byModel = new Map()
  let samples = 0
  for (const row of rows) {
    const latency = floatFromRow(row, 'avg_latency')
    if (latency === null || !(latency > 0)) continue
    const model = typeof row.model === 'string' && row.model.trim() !== '' ? row.model : null
    const key = model === null ? '\u0000' : model
    let entry = byModel.get(key)
    if (entry === undefined) {
      entry = { model, latencies: [], buckets: LATENCY_BUCKETS.map(() => []) }
      byModel.set(key, entry)
    }
    entry.latencies.push(latency)
    const completion = counterFromRow(row, 'total_completion_tokens')
    const index = LATENCY_BUCKETS.findIndex((bucket) => completion <= bucket.max)
    entry.buckets[index === -1 ? entry.buckets.length - 1 : index].push(latency)
    samples += 1
  }

  const models = [...byModel.values()]
    .map((entry) => {
      const sorted = [...entry.latencies].sort((left, right) => left - right)
      return {
        model: entry.model,
        samples: sorted.length,
        medianLatency: round3(percentile(sorted, 0.5)),
        p90Latency: round3(percentile(sorted, 0.9)),
        buckets: entry.buckets.map((values, index) => ({
          key: LATENCY_BUCKETS[index].key,
          count: values.length,
          medianLatency: round3(percentile([...values].sort((left, right) => left - right), 0.5)),
        })),
      }
    })
    .sort((left, right) => {
      const leftValue = left.medianLatency ?? -1
      const rightValue = right.medianLatency ?? -1
      if (leftValue === rightValue) return right.samples - left.samples
      return rightValue - leftValue
    })

  return { samples, models }
}

/**
 * Собрать отчёт за сегодня и с начала месяца.
 * @param {object} input параметры отчёта
 * @param {string} input.baseUrl адрес API
 * @param {string} input.token управляющий ключ
 * @param {string} [input.balanceToken] обычный API-ключ для точного баланса
 * @param {Date} [input.now] текущий момент
 * @param {string} [input.timeZone] IANA-зона границ периодов
 * @param {typeof fetch} [input.fetchImpl] подмена транспорта
 * @returns {Promise<object>} отчёт для панели
 */
export async function fetchReport({ baseUrl, token, balanceToken = '', now = new Date(), timeZone = '', fetchImpl = fetch }) {
  const dayStart = startOfDay(now, timeZone)
  const monthStart = startOfMonth(now, timeZone)
  const ranges = {
    today: { start: dayStart, end: now },
    month: { start: monthStart, end: now },
  }

  const withRetry = async (run) => {
    try {
      return await run()
    } catch (error) {
      // Один повтор после 429: лимит короткий, а панель делает несколько
      // запросов подряд.
      if (error instanceof AnalyticsError && error.code === 'rate-limited') {
        await sleep(700)
        return run()
      }
      throw error
    }
  }

  const readModels = (range) =>
    withRetry(() => queryPeriod({ baseUrl, token, start: range.start, end: range.end, fetchImpl }))

  const today = await readModels(ranges.today)
  const month = await readModels(ranges.month)

  // Точный остаток требует обычного API-ключа: /v1/balance — inference-эндпоинт.
  // Без него показывается оценка по пополнениям и расходам управляющего ключа.
  let balance = null
  if (balanceToken !== '') {
    try {
      balance = await withRetry(() => fetchBalance({ baseUrl, token: balanceToken, fetchImpl }))
    } catch {
      balance = null
    }
  }
  if (balance === null) {
    try {
      balance = await withRetry(() => fetchCredits({ baseUrl, token, fetchImpl }))
    } catch {
      balance = null
    }
  }

  // Дневная полоса — вспомогательная: если сервис откажет именно ей,
  // остальной отчёт всё равно показывается, а полоса просто скрывается.
  let hourlyRows = []
  let hourlyFailed = false
  try {
    const hourly = await withRetry(() =>
      queryHourly({ baseUrl, token, start: ranges.month.start, end: ranges.month.end, fetchImpl }),
    )
    hourlyRows = hourly.rows
  } catch {
    hourlyFailed = true
  }

  const todayAggregate = aggregate(today.rows)
  const monthAggregate = aggregate(month.rows)
  const days = hourlyFailed ? [] : dailySeries(hourlyRows, ranges.month.start, now, timeZone)

  return {
    generatedAt: now.toISOString(),
    currency: today.currency ?? month.currency ?? balance?.currency ?? null,
    truncated: today.truncated || month.truncated,
    timeZone: timeZone === '' ? null : timeZone,
    ranges: {
      today: { start: ranges.today.start.toISOString(), end: ranges.today.end.toISOString() },
      month: { start: ranges.month.start.toISOString(), end: ranges.month.end.toISOString() },
    },
    periods: {
      today: serializeAggregate(todayAggregate),
      month: serializeAggregate(monthAggregate),
    },
    daily: {
      start: ranges.month.start.toISOString(),
      end: ranges.month.end.toISOString(),
      days: days.map((day) => ({ date: day.date, micros: day.micros.toString(), requests: day.requests })),
    },
    forecast: forecastFor(monthAggregate.totalMicros, ranges.month.start, now, timeZone),
    balance,
  }
}

/** Счётчики без денег: запросы, ошибки, токены и задержка. */
function serializeCounters(value) {
  return {
    requests: value.requests,
    errors: value.errors,
    promptTokens: value.promptTokens,
    completionTokens: value.completionTokens,
    reasoningTokens: value.reasoningTokens,
    cachedTokens: value.cachedTokens,
    avgLatency: value.avgLatency,
  }
}

/** Перевести агрегат в JSON: суммы — строки, чтобы знаки не потерялись. */
function serializeAggregate(value) {
  return {
    totalMicros: value.totalMicros.toString(),
    ...serializeCounters(value),
    models: value.models.map((model) => ({
      model: model.model,
      micros: model.micros.toString(),
      ...serializeCounters(model),
      averageMicros: model.averageMicros === null ? null : model.averageMicros.toString(),
    })),
  }
}
