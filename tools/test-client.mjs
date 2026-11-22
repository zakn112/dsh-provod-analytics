/**
 * Структурная проверка половины Client без браузера: модуль регистрирует
 * ровно два места (пункт в списке панелей и страницу `main`), значок рисуется
 * без хуков, а помощники таблиц ранжируют строки так, как обещает подпись.
 *
 * Запуск: node provod-analytics/tools/test-client.mjs
 */
import assert from 'node:assert/strict'

/** Мини-React: `createElement` возвращает описание узла, хуки — заглушки. */
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return {
      type,
      props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
    }
  },
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
}

const registrations = []
const injectedOwners = []
let entry = null

globalThis.window = {
  __ModuleLoader__: {
    load(candidate) {
      entry = candidate
    },
  },
}

await import('../client.js')

assert.ok(entry !== null, 'модуль должен зарегистрировать фабрику')
assert.equal(entry.id, 'dsh-provod-analytics', 'id фабрики совпадает с именем пакета')

const factoryRequire = (name) => {
  if (name === 'react') return React
  throw new Error(`неожиданный require: ${name}`)
}

const moduleExports = entry.factory(factoryRequire)
assert.ok(moduleExports !== null && typeof moduleExports === 'object', 'фабрика возвращает объект плагина')
assert.deepEqual(moduleExports.inject, ['slots', 'locale'])

const dictionaries = []
const ctx = {
  locale: {
    bind: () => (key) => `copy:${key}`,
    register: (ns, locale, dict) => {
      dictionaries.push({ ns, locale, dict })
      return () => {}
    },
  },
  slots: {
    inject(owner, callback) {
      injectedOwners.push(owner)
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  effect(effect) {
    return effect()
  },
}

moduleExports.apply(ctx)

assert.deepEqual(injectedOwners.sort(), ['main', 'sidebar.panellist'], 'обе панели объявлены')

const panel = registrations.find((item) => item.options.name === 'sidebar.panellist')
const page = registrations.find((item) => item.options.name === 'main')
assert.ok(panel !== undefined, 'пункт списка панелей зарегистрирован')
assert.ok(page !== undefined, 'страница main зарегистрирована')
assert.equal(panel.options.id, 'provod-analytics')
assert.equal(page.options.key, 'provod-analytics')
assert.equal(panel.options.locale, 'provod.analytics')
assert.equal(typeof panel.options.label, 'function')
assert.equal(panel.options.label(), 'copy:panel')
assert.equal(typeof panel.component, 'function')
assert.equal(typeof page.component, 'function')

assert.ok(dictionaries.length >= 2, 'словари локали зарегистрированы')
assert.equal(dictionaries[0].ns, 'provod.analytics')
assert.ok(dictionaries.some((item) => item.locale === 'ru' && item.dict.panel === 'Расходы'))
assert.ok(dictionaries.some((item) => item.locale === 'en' && item.dict.panel === 'Spending'))

const icon = panel.component({ size: 16, active: true })
assert.equal(icon.type, 'svg')
assert.equal(icon.props.width, 16)
assert.equal(icon.props.height, 16)

const nodes = icon.props.children
assert.equal(nodes.length, 3, 'значок — три столбика')

// Ранжирование: эффективность — по «цене × времени на 1M», задержки — от быстрых.
const helpers = moduleExports.helpers
assert.ok(helpers !== null && typeof helpers === 'object', 'фабрика отдаёт helpers для проверок')

// Отсев: мало запросов, высокая доля ошибок, нет расходов — не в рейтинге.
const healthy = { month: { requests: 10, errors: 0, micros: '100000000', avgLatency: 2 } }
assert.equal(helpers.excludedReason(healthy), null)
assert.equal(helpers.excludedReason({ month: { requests: 3, errors: 0, micros: '1', avgLatency: 2 } }), 'fewRequests')
assert.equal(helpers.excludedReason({ month: { requests: 10, errors: 3, micros: '1', avgLatency: 2 } }), 'highErrors')
assert.equal(
  helpers.excludedReason({ month: { requests: 10, errors: 2, micros: '1', avgLatency: 2 } }),
  null,
  'ровно 20 % — ещё проходит',
)
assert.equal(helpers.excludedReason({ month: { requests: 10, errors: 0, micros: '0', avgLatency: 2 } }), 'noSpending')
assert.equal(helpers.excludedReason({ month: null }), 'noRequests')

const split = helpers.splitForRanking([
  { key: 'ok', ...healthy },
  { key: 'free', month: { requests: 50, errors: 0, micros: '0', avgLatency: 1 } },
  { key: 'flaky', month: { requests: 40, errors: 30, micros: '500000000', avgLatency: 0.5 } },
])
assert.deepEqual(
  split.ranked.map((entry) => entry.key),
  ['ok'],
  'бесплатная и ошибочная модели не участвуют в рейтинге',
)
assert.deepEqual(
  split.excluded.map((item) => [item.entry.key, item.reason]),
  [
    ['free', 'noSpending'],
    ['flaky', 'highErrors'],
  ],
)

/** Сравнение чисел с плавающей точкой. */
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''}: ожидалось ${expected}, получено ${actual}`)

// «Цена с поправкой»: 1M токенов за 10 запросов по 6 с — ровно эталон 60 с/1M,
// поэтому балл равен цене: 2 ₽/1M → 2.
const base = { requests: 10, micros: '200000000', avgLatency: 6, promptTokens: 800000, completionTokens: 200000 }
close(helpers.adjustedCostOf({ month: base }), 2)
close(helpers.adjustedCostOf({ month: { ...base, micros: '100000000' } }), 1, 'вдвое дешевле — вдвое лучше')
close(helpers.adjustedCostOf({ month: { ...base, avgLatency: 12 } }), 8, 'вдвое медленнее эталона — вчетверо хуже')

// Главное свойство: объём контекста на балл не влияет.
const bigger = { requests: 100, micros: '2000000000', avgLatency: 6, promptTokens: 8000000, completionTokens: 2000000 }
close(helpers.adjustedCostOf({ month: bigger }), 2, 'вдесятеро больший объём — тот же балл')

// Вдвое медленнее поднимается наверх только вчетверо дешевле: 0,5 ₽/1M при 120 с/1M
// даёт тот же балл, что 2 ₽/1M при 60 с/1M.
close(helpers.adjustedCostOf({ month: { ...base, micros: '50000000', avgLatency: 12 } }), 2, 'вчетверо дешевле компенсирует вдвое большее время')

assert.equal(helpers.adjustedCostOf({ month: null }), Number.POSITIVE_INFINITY)
assert.equal(
  helpers.adjustedCostOf({ month: { requests: 10, micros: '1', avgLatency: 2 } }),
  Number.POSITIVE_INFINITY,
  'без токенов балла нет',
)

const ranked = helpers.sortByAdjustedCostAsc([
  { key: 'slower', month: { ...base, avgLatency: 12 } },
  { key: 'base', month: base },
  { key: 'cheaper', month: { ...base, micros: '100000000' } },
  { key: 'none', month: null },
])
assert.deepEqual(
  ranked.map((entry) => entry.key),
  ['cheaper', 'base', 'slower', 'none'],
  'по цене с поправкой на время; без данных — в конце',
)

// Бесконечности не дают NaN в компараторе: два «без данных» равны между собой.
assert.equal(helpers.sortByAdjustedCostAsc([{ month: null }, { month: null }]).length, 2)

assert.equal(helpers.speedOf({ month: { requests: 10, avgLatency: 2, completionTokens: 1000 } }), 50)
assert.equal(helpers.speedOf({ month: { requests: 5, avgLatency: 4, completionTokens: 0 } }), 0)
assert.equal(helpers.speedOf({ month: null }), -1, 'нет данных — в конец')
assert.equal(helpers.speedOf({ month: { requests: 0, avgLatency: 2, completionTokens: 10 } }), -1)
assert.equal(helpers.speedOf({ month: { requests: 5, avgLatency: null, completionTokens: 10 } }), -1)

assert.equal(helpers.meanLatencyOf({ month: { avgLatency: 4 } }), 4)
assert.equal(helpers.meanLatencyOf({ month: { avgLatency: 0 } }), 0)
assert.equal(helpers.meanLatencyOf({ month: null }), Number.POSITIVE_INFINITY, 'нет данных — в конец')
assert.equal(helpers.meanLatencyOf({ month: { avgLatency: null } }), Number.POSITIVE_INFINITY)

// Скорость потока и время ожидания расходятся: модель может «течь» быстро,
// но ждать её дольше — поэтому ранжирование идёт по времени, а не по ток/с.
const streaming = {
  key: 'streaming',
  month: { requests: 10, avgLatency: 40, completionTokens: 12000, micros: '900000000' },
}
const brisk = { key: 'brisk', month: { requests: 10, avgLatency: 5, completionTokens: 800, micros: '100000000' } }
assert.ok(
  helpers.speedOf(streaming) > helpers.speedOf(brisk),
  'у модели с ожиданием 40 с скорость потока выше, чем у модели с 5 с',
)
assert.ok(
  helpers.meanLatencyOf(brisk) < helpers.meanLatencyOf(streaming),
  'но ждать её дольше — ток/с не годится для ранжирования',
)

const byLatency = helpers.sortByMedianAsc([
  { model: 'slowest', medianLatency: 9, samples: 10 },
  { model: 'fastest', medianLatency: 1, samples: 3 },
  { model: 'unknown', medianLatency: null, samples: 5 },
])
assert.deepEqual(
  byLatency.map((entry) => entry.model),
  ['fastest', 'slowest', 'unknown'],
)

// ТОП-10 в «Расходах по моделям»: до раскрытия — десять строк, после — все.
const many = Array.from({ length: 12 }, (_, index) => ({ key: `m${index}` }))
assert.equal(helpers.TOP_MODELS, 10, 'лимит списка моделей — 10')
assert.equal(helpers.limitRows(many, false).length, 10, 'до нажатия «Показать все» — десять строк')
assert.equal(helpers.limitRows(many, true).length, 12, 'после раскрытия — все строки')
assert.equal(helpers.limitRows(many.slice(0, 3), false).length, 3, 'короткий список не урезается')

console.log('ok   client module: фабрика, панель, страница, словари, значок, порядок таблиц')
