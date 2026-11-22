/**
 * Расходы Provod — точка входа плагина на стороне Host.
 *
 * Сам код лежит в `lib/` и подключается со штампом по самому свежему mtime:
 * Host кеширует ES-модули по спецификатору, поэтому правка `lib/` подхватывается
 * при следующем запуске строки плагина (переключатель в «Плагинах»), без
 * перезапуска приложения.
 */
import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const libDirectory = fileURLToPath(new URL('./lib/', import.meta.url))

/** Самый свежий mtime среди модулей `lib/`. */
async function libraryStamp() {
  try {
    const names = (await readdir(libDirectory)).filter((name) => name.endsWith('.mjs')).sort()
    let newest = 0
    for (const name of names) {
      const info = await stat(resolve(libDirectory, name))
      if (info.mtimeMs > newest) newest = info.mtimeMs
    }
    return Math.round(newest).toString()
  } catch {
    return '0'
  }
}

/** Без HTTP-сервера панели нечего обслуживать. */
export const inject = ['webServer']

/**
 * Зарегистрировать маршруты панели расходов.
 * @param {object} ctx контекст плагина
 * @param {unknown} config конфигурация строки Loader
 * @returns {() => void} снятие ресурсов
 */
export function apply(ctx, config) {
  const logger = ctx.get('logger')
  let dispose
  let disposed = false

  const start = (async () => {
    const stamp = await libraryStamp()
    const server = await import(`./lib/server.mjs?v=${stamp}`)
    return server.install(ctx, config ?? {}, stamp)
  })()

  start.then(
    (cleanup) => {
      if (disposed) cleanup()
      else dispose = cleanup
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      logger?.error?.(`provod-analytics: маршруты не установлены: ${message}`)
    },
  )

  return () => {
    disposed = true
    try {
      dispose?.()
    } catch {
      // Снятие маршрутов не должно мешать остальной разборке.
    }
  }
}
