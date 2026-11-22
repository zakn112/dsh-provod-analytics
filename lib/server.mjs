/**
 * Расходы Provod — половина Host: два HTTP-маршрута под префиксом
 * `/provod-analytics/api` и всё, что требует Cordis.
 *
 *   POST /provod-analytics/api/status  {}
 *     → { configured, source, writable, baseUrl, apiKeyName, timeZone }
 *   POST /provod-analytics/api/report  {}
 *     → отчёт за сегодня и с начала месяца (см. `lib/core.mjs`)
 *   POST /provod-analytics/api/key     { token } | { clear: true }
 *     → сохранить или удалить управляющий ключ
 *
 * Ключ берётся из хранилища учётных данных DSH по имени `apiKeyName`
 * (по умолчанию `PROVOD_MANAGEMENT_API_KEY`), затем из `config.token`, затем
 * из переменной окружения. Значение никогда не уходит клиенту — только факт
 * «настроен» и источник.
 */
// Тот же штамп, с которым загружен этот модуль: иначе правка `core.mjs`
// осталась бы в кеше ES-модулей Host.
const stamp = new URL(import.meta.url).search
const {
  AnalyticsError,
  fetchReport,
  isValidTimeZone,
  normalizeConfig,
} = await import(`./core.mjs${stamp}`)

export const API_PREFIX = '/provod-analytics/api'
const MAX_BODY_BYTES = 64 * 1024

/** Ответ JSON без кеша. */
function writeJson(res, status, body) {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** Успешный ответ. */
function writeValue(res, value) {
  writeJson(res, 200, { ok: true, value })
}

/** Ошибка домена: статус по коду, текст для панели. */
function writeFailure(res, error, logger) {
  const code = error instanceof AnalyticsError ? error.code : 'internal'
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'internal') logger?.warn?.(`provod-analytics: ${message}`)
  const status = code === 'bad-request' || code === 'no-store' ? 400 : code === 'forbidden' ? 403 : 200
  writeJson(res, status, { ok: false, error: { code, message } })
}

/** Тело запроса как JSON; пустое тело — пустой объект. */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new AnalyticsError('bad-request', 'Тело запроса слишком велико')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new AnalyticsError('bad-request', 'Тело запроса не разобрано как JSON')
  }
}

/**
 * Текущий ключ и его источник.
 * @param {object} ctx контекст плагина
 * @param {{ apiKeyName: string, token: string }} settings настройки строки
 * @param {object | undefined} logger журнал Host
 * @returns {Promise<{ token: string, source: string } | null>}
 */
async function resolveKey(ctx, settings, logger) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(settings.apiKeyName)
      const value = hit !== null && typeof hit === 'object' && typeof hit.value === 'string' ? hit.value.trim() : ''
      if (value !== '') return { token: value, source: typeof hit.source === 'string' ? hit.source : 'store' }
    } catch (error) {
      logger?.warn?.(`provod-analytics: чтение ключа не удалось: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (settings.token !== '') return { token: settings.token, source: 'config' }
  const env = process.env[settings.apiKeyName]
  if (typeof env === 'string' && env.trim() !== '') return { token: env.trim(), source: 'environment' }
  return null
}

/**
 * Состояние ключа для панели: настроен ли, откуда, можно ли перезаписать.
 * @param {object} ctx контекст плагина
 * @param {{ apiKeyName: string, token: string }} settings настройки строки
 * @returns {Promise<object>}
 */
async function describeKey(ctx, settings) {
  const credentials = ctx.get('credentials')
  const hasStore = credentials !== undefined && typeof credentials.describe === 'function'
  let configured = false
  let source = null
  let writable = hasStore
  if (hasStore) {
    try {
      const info = await credentials.describe(settings.apiKeyName)
      configured = info !== null && typeof info === 'object' && info.configured === true
      if (configured) source = typeof info.source === 'string' ? info.source : 'store'
      if (info !== null && typeof info === 'object' && info.writable === false) writable = false
    } catch {
      configured = false
    }
  }
  if (!configured && settings.token !== '') {
    configured = true
    source = 'config'
  }
  if (!configured) {
    const env = process.env[settings.apiKeyName]
    if (typeof env === 'string' && env.trim() !== '') {
      configured = true
      source = 'environment'
    }
  }
  // Удалить ключ можно только из хранилища: значение из окружения или
  // `config.token` этим маршрутом не убрать, и кнопка не должна это обещать.
  const removable = configured && source === 'store' && hasStore
  return { configured, source, writable, removable, hasStore }
}

/** Сохранить ключ в хранилище учётных данных, иначе — в конфигурацию строки. */
async function storeKey(ctx, settings, token) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.set === 'function') {
    await credentials.set(settings.apiKeyName, token)
    return 'store'
  }
  const editor = ctx.get('configEditor')
  const entry = ctx.fiber?.entry
  if (editor !== undefined && typeof editor.edit === 'function' && entry !== undefined) {
    await editor.edit(entry, (current) => ({ ...current, token }))
    return 'config'
  }
  throw new AnalyticsError(
    'no-store',
    `Нет хранилища учётных данных: задайте ключ в cordis.patch.yml полем token или переменной ${settings.apiKeyName}.`,
  )
}

/** Удалить сохранённый ключ. */
async function forgetKey(ctx, settings) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.unset === 'function') {
    const state = await describeKey(ctx, settings)
    if (state.source !== 'store') {
      throw new AnalyticsError(
        'no-store',
        `Ключ задан вне хранилища DSH (${state.source ?? 'источник неизвестен'}): удалите его там, где он указан.`,
      )
    }
    await credentials.unset(settings.apiKeyName)
    return 'store'
  }
  const editor = ctx.get('configEditor')
  const entry = ctx.fiber?.entry
  if (editor !== undefined && typeof editor.edit === 'function' && entry !== undefined) {
    await editor.edit(entry, (current) => ({ ...current, token: '' }))
    return 'config'
  }
  throw new AnalyticsError('no-store', 'Удалять нечего: ключ приходит из окружения или конфигурации.')
}

/**
 * Зарегистрировать маршруты панели на этом Host.
 * @param {object} ctx контекст плагина
 * @param {unknown} config конфигурация строки Loader
 * @param {string} stamp отпечаток `lib/`, виденный при запуске
 * @returns {() => void} снятие маршрутов
 */
export function install(ctx, config, stamp) {
  const logger = ctx.get('logger')
  const settings = normalizeConfig(config)
  if (!isValidTimeZone(settings.timeZone)) {
    logger?.warn?.(`provod-analytics: неизвестная зона «${settings.timeZone}», границы периодов считаются по зоне Host`)
  }

  const handler = async (req, res) => {
    const connection = ctx.get('connection')
    if (connection !== undefined && typeof connection.requestRejection === 'function') {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Запрос не от этого клиента.' } })
        return
      }
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'Используйте POST.' } })
      return
    }

    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const op = pathname.slice(API_PREFIX.length).replace(/^\/+/, '')

    try {
      if (op === 'status') {
        const key = await describeKey(ctx, settings)
        writeValue(res, {
          ...key,
          baseUrl: settings.baseUrl,
          apiKeyName: settings.apiKeyName,
          timeZone: settings.timeZone === '' ? null : settings.timeZone,
          stamp,
        })
        return
      }

      if (op === 'report') {
        const key = await resolveKey(ctx, settings, logger)
        if (key === null) {
          throw new AnalyticsError('no-key', `Не настроен управляющий ключ Provod (${settings.apiKeyName}).`)
        }
        const report = await fetchReport({
          baseUrl: settings.baseUrl,
          token: key.token,
          timeZone: isValidTimeZone(settings.timeZone) ? settings.timeZone : '',
        })
        writeValue(res, { ...report, keySource: key.source })
        return
      }

      if (op === 'key') {
        const body = await readJsonBody(req)
        if (body.clear === true) {
          const where = await forgetKey(ctx, settings)
          writeValue(res, { cleared: true, where })
          return
        }
        const token = typeof body.token === 'string' ? body.token.trim() : ''
        if (token === '') throw new AnalyticsError('bad-request', 'Пустой ключ сохранить нельзя')
        const where = await storeKey(ctx, settings, token)
        writeValue(res, { saved: true, where })
        return
      }

      writeJson(res, 404, { ok: false, error: { code: 'unknown-operation', message: `Неизвестная операция «${op}»` } })
    } catch (error) {
      writeFailure(res, error, logger)
    }
  }

  const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
  logger?.info?.(`provod-analytics: маршруты готовы (${API_PREFIX}, stamp=${stamp})`)

  return () => {
    try {
      disposeRoute()
    } catch {
      // Снятие маршрута не должно мешать остальной разборке.
    }
  }
}
