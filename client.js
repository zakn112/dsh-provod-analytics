/**
 * Расходы Provod — половина Client: пункт в списке панелей левого столбца и
 * собственная страница в центральной колонке.
 *
 * Страница берёт данные у своего же Host по `POST /provod-analytics/api/*`
 * (`status`, `report`, `key`) и сама ничего не считает о деньгах: суммы
 * приходят в «микро» (1 ₽ = 100000000) строками, чтобы знаки не терялись,
 * а здесь только форматируются.
 */
window.__ModuleLoader__.load({
  id: 'dsh-provod-analytics',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const API = '/provod-analytics/api'
    const NS = 'provod.analytics'
    const PANEL_ID = 'provod-analytics'
    const DOCS_URL = 'https://provod.ai/ru/docs/analytics-query'
    const CABINET_URL = 'https://app.provod.ai'

    const COPY = {
      ru: {
        panel: 'Расходы',
        title: 'Расходы на API',
        subtitle: 'Provod · управляющий ключ рабочего пространства',
        today: 'Сегодня',
        month: 'С начала месяца',
        refresh: 'Обновить',
        key: 'Ключ',
        keyHide: 'Скрыть',
        loading: 'Загрузка…',
        noData: 'За период записей нет.',
        modelUnknown: 'Без модели',
        colModel: 'Модель',
        colShare: 'Доля месяца',
        colRequests: 'Запросов за месяц',
        totalRow: 'Итого',
        requests: 'Запросов',
        breakdownTitle: 'Расходы по моделям',
        breakdownHint:
          'Полосы: длина — относительно крупнейшей модели периода, рядом — сумма. Ниже таблица с суммами за оба периода.',
        dailyTitle: 'Расходы по дням',
        averageDay: 'Средний день',
        forecastCard: 'Прогноз до конца месяца',
        forecastFoot: 'по темпу с начала месяца',
        forecastNoData: 'мало данных за месяц',
        daysUnit: 'дн.',
        efficiencyTitle: 'Эффективность моделей',
        efficiencyHint:
          'За месяц: объём токенов на запрос, цена за миллион, попадания в кеш, доля ошибок, среднее время ответа и скорость выхода. Скорость — это токены в секунду, а не время ожидания: рассуждающая модель выдаёт токены быстро, но их в разы больше на запрос, поэтому ждать приходится дольше. «Цена с поправкой» — цена миллиона токенов, пересчитанная на эталонные 60 с обработки: модель вдвое медленнее эталона получает вчетверо больший балл, то есть поднимается выше, только если значительно дешевле. Меньше — лучше, строки — от лучшей к худшей.',
        colScore: 'Цена с поправкой',
        notRankedTitle: 'Не ранжированы',
        reasonNoRequests: 'нет запросов',
        reasonFewRequests: 'меньше 5 запросов',
        reasonHighErrors: 'больше 20 % ошибок',
        reasonNoSpending: 'без расходов, например бесплатная модель',
        colTokens: 'Токенов на запрос',
        colReasoning: 'Рассуждений на запрос',
        colPerMillion: 'За 1M токенов',
        colCache: 'Кеш входа',
        colErrors: 'Ошибки',
        colLatency: 'Среднее время',
        colSpeed: 'Скорость',
        unitSeconds: 'с',
        unitTokensPerSecond: 'ток/с',
        balanceCard: 'Остаток на счёте',
        balanceFoot: 'доступно к использованию',
        balanceReserved: 'в резерве',
        balanceApproximate: '≈ пополнения минус расходы',
        balanceUnavailable: 'нет данных',
        needCard: 'Потребность до конца месяца (прогноз)',
        needFoot: 'прогноз минус с начала месяца',
        showAll: 'Показать все',
        showLess: 'Свернуть',
        errorTitle: 'Не удалось получить данные',
        retry: 'Повторить',
        changeKey: 'Сменить ключ',
        setupTitle: 'Нужен управляющий ключ Provod',
        setupHint:
          'Отчёт о расходах доступен только управляющему ключу рабочего пространства. Создайте ключ в кабинете Provod и вставьте его здесь: значение сохранится в хранилище учётных данных DSH и не попадёт в cordis.patch.yml.',
        keyPlaceholder: 'Управляющий ключ (management key)',
        keySave: 'Сохранить ключ',
        keySaving: 'Сохранение…',
        keySaved: 'Ключ сохранён.',
        keyCleared: 'Ключ удалён.',
        keyForget: 'Удалить ключ',
        keyForgetConfirm: 'Подтвердить удаление',
        keySource: 'Источник',
        keySourceStore: 'хранилище DSH',
        keySourceEnvironment: 'переменная окружения',
        keySourceConfig: 'конфигурация плагина',
        keyReadOnly: 'Ключ задан вне хранилища DSH — здесь его нельзя удалить.',
        keyCabinet: 'Создать ключ в кабинете Provod',
        docs: 'Документация Provod',
        updatedAt: 'Обновлено',
        truncated: 'Сервис вернул не все строки: суммы и средние неполные.',
        rangeFrom: 'с',
      },
      en: {
        panel: 'Spending',
        title: 'API spending',
        subtitle: 'Provod · workspace management key',
        today: 'Today',
        month: 'Month to date',
        refresh: 'Refresh',
        key: 'Key',
        keyHide: 'Hide',
        loading: 'Loading…',
        noData: 'No records for this period.',
        modelUnknown: 'No model',
        colModel: 'Model',
        colShare: 'Month share',
        colRequests: 'Month requests',
        totalRow: 'Total',
        requests: 'Requests',
        breakdownTitle: 'Spending by model',
        breakdownHint:
          'Bars: length is relative to the largest model of the period, the sum is beside it. The table below repeats both periods.',
        dailyTitle: 'Spending by day',
        averageDay: 'Average day',
        forecastCard: 'Month-end forecast',
        forecastFoot: 'at the month-to-date pace',
        forecastNoData: 'not enough data yet',
        daysUnit: 'days',
        efficiencyTitle: 'Model efficiency',
        efficiencyHint:
          'Month to date: tokens per request, price per million, cache hits, error share, mean response time and output speed. Speed is tokens per second, not waiting time: a reasoning model may stream fast yet produce far more tokens per request, so the wait is longer. “Time-adjusted cost” is the price of a million tokens rescaled to a 60-second reference: a model twice as slow as the reference scores four times worse, so it climbs only if it is much cheaper. Lower is better; rows run from best to worst.',
        colScore: 'Time-adjusted cost',
        notRankedTitle: 'Not ranked',
        reasonNoRequests: 'no requests',
        reasonFewRequests: 'fewer than 5 requests',
        reasonHighErrors: 'over 20% errors',
        reasonNoSpending: 'no spending, e.g. a free model',
        colTokens: 'Tokens per request',
        colReasoning: 'Reasoning per request',
        colPerMillion: 'Per 1M tokens',
        colCache: 'Input cached',
        colErrors: 'Errors',
        colLatency: 'Mean time',
        colSpeed: 'Speed',
        unitSeconds: 's',
        unitTokensPerSecond: 'tok/s',
        balanceCard: 'Account balance',
        balanceFoot: 'available to use',
        balanceReserved: 'reserved',
        balanceApproximate: '≈ credits minus usage',
        balanceUnavailable: 'no data',
        needCard: 'Needed to month end (forecast)',
        needFoot: 'forecast minus month to date',
        showAll: 'Show all',
        showLess: 'Show less',
        errorTitle: 'Could not load the report',
        retry: 'Retry',
        changeKey: 'Change key',
        setupTitle: 'A Provod management key is required',
        setupHint:
          'Spending reports are available only to a workspace management key. Create one in the Provod console and paste it here: the value is stored in the DSH credential store and never written to cordis.patch.yml.',
        keyPlaceholder: 'Management key',
        keySave: 'Save key',
        keySaving: 'Saving…',
        keySaved: 'Key saved.',
        keyCleared: 'Key removed.',
        keyForget: 'Remove key',
        keyForgetConfirm: 'Confirm removal',
        keySource: 'Source',
        keySourceStore: 'DSH credential store',
        keySourceEnvironment: 'environment variable',
        keySourceConfig: 'plugin configuration',
        keyReadOnly: 'The key is set outside the DSH credential store and cannot be removed here.',
        keyCabinet: 'Create a key in the Provod console',
        docs: 'Provod documentation',
        updatedAt: 'Updated',
        truncated: 'The service returned only some rows: sums and averages are incomplete.',
        rangeFrom: 'from',
      },
    }

    const LOCALE_IDS = ['ru', 'en', 'zh', 'ja', 'es', 'fr', 'de', 'pt']

    /** Подпись на случай, если локаль не пришла из оболочки. */
    function fallbackText(key) {
      return COPY.ru[key] ?? key
    }

    const CSS = `
      .pa-root{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;
        overflow:hidden;font-size:13px;line-height:1.5;
        color:var(--dsw-alias-label-primary,inherit);
        background:var(--dsw-alias-bg-base,transparent)}
      /* Палитра серий: авторские цвета для полос, меток моделей и акцентов.
         Поверхности, текст и границы остаются на токенах темы. Средние тона
         выбраны так, чтобы читаться и на светлом, и на тёмном фоне. */
      .pa-root{--pa-c1:#4f8ef7;--pa-c2:#2fb344;--pa-c3:#e8a317;--pa-c4:#a25cf0;
        --pa-c5:#17a2b8;--pa-c6:#e35561;--pa-c7:#7aa116;--pa-c8:#d653a8}
      .pa-root .pa-series-1{--pa-series:var(--pa-c1)}
      .pa-root .pa-series-2{--pa-series:var(--pa-c2)}
      .pa-root .pa-series-3{--pa-series:var(--pa-c3)}
      .pa-root .pa-series-4{--pa-series:var(--pa-c4)}
      .pa-root .pa-series-5{--pa-series:var(--pa-c5)}
      .pa-root .pa-series-6{--pa-series:var(--pa-c6)}
      .pa-root .pa-series-7{--pa-series:var(--pa-c7)}
      .pa-root .pa-series-8{--pa-series:var(--pa-c8)}
      .pa-dot{width:8px;height:8px;border-radius:999px;flex:0 0 auto;display:inline-block;
        background:var(--pa-series,var(--dsw-alias-brand-primary,#3a6df0))}
      .pa-head{display:flex;align-items:center;gap:10px;flex:0 0 auto;padding:10px 16px;
        border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));min-height:44px}
      .pa-head-text{display:flex;flex-direction:column;gap:1px;min-width:0}
      .pa-head-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pa-head-sub{font-size:11px;color:var(--dsw-alias-label-secondary,inherit);opacity:.85;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pa-spacer{flex:1;min-width:4px}
      .pa-btn{font:inherit;font-size:12px;display:inline-flex;align-items:center;gap:5px;padding:3px 10px;
        border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));border-radius:6px;
        background:transparent;color:inherit;cursor:pointer;white-space:nowrap}
      .pa-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
      .pa-btn[data-active="1"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}
      .pa-btn:disabled{opacity:.45;cursor:default}
      .pa-btn:focus-visible,.pa-sort:focus-visible,.pa-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3a6df0);
        outline-offset:1px}
      /* Пара «акцент на фоне приложения»: в тёмной теме акцент светлый, в
         светлой — тёмный, поэтому подпись всегда контрастна без литералов. */
      .pa-btn-primary{background:var(--dsw-alias-brand-primary,#3a6df0);border-color:transparent;
        color:var(--dsw-alias-bg-base,#fff)}
      .pa-btn-primary:hover:not(:disabled){opacity:.88;background:var(--dsw-alias-brand-primary,#3a6df0)}
      .pa-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:16px}
      .pa-content{width:100%;max-width:1040px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
      .pa-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
      .pa-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:10px;
        padding:12px 14px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));
        box-shadow:inset 3px 0 0 var(--pa-series,transparent)}
      .pa-card-label{font-size:11px;letter-spacing:.05em;text-transform:uppercase;
        color:var(--dsw-alias-label-secondary,inherit);
        min-height:33px;display:flex;align-items:flex-end;line-height:1.35}
      .pa-card-value{font-size:clamp(20px,3vw,26px);line-height:1.25;font-weight:600;
        font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pa-card-foot{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary,inherit);opacity:.85;
        font-variant-numeric:tabular-nums}
      .pa-section{display:flex;flex-direction:column;gap:8px;min-width:0}
      .pa-section-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
      .pa-section-title{font-size:13px;font-weight:600;margin:0}
      .pa-section-hint{font-size:11px;color:var(--dsw-alias-label-secondary,inherit);margin:0;
        flex:1 1 320px;min-width:0}
      .pa-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
      .pa-chart{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:10px;
        padding:10px 12px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));min-width:0}
      .pa-chart-title{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.05em;
        text-transform:uppercase;margin-bottom:8px;
        color:var(--dsw-alias-label-secondary,inherit)}
      .pa-days-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:10px;
        padding:12px 14px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}
      .pa-days{display:flex;align-items:flex-end;gap:3px;height:72px;min-width:0}
      .pa-day{flex:1 1 0;min-width:2px;height:100%;display:flex;align-items:flex-end}
      .pa-day-track{width:100%;height:100%;display:flex;align-items:flex-end;border-radius:3px;
        overflow:hidden;background:var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
      .pa-day-fill{width:100%;border-radius:3px;min-height:2px;
        background:var(--pa-series,var(--dsw-alias-brand-primary,#3a6df0))}
      .pa-day:hover .pa-day-track{background:var(--dsw-alias-border-l2,rgba(127,127,127,.4))}
      .pa-bars{display:flex;flex-direction:column;gap:8px}
      .pa-bar{display:flex;flex-direction:column;gap:3px;min-width:0}
      .pa-bar-head{display:flex;align-items:baseline;gap:8px;font-size:12px;min-width:0}
      .pa-bar-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pa-bar-amount{flex:0 0 auto;font-variant-numeric:tabular-nums;font-weight:600}
      .pa-bar-track{height:8px;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.22));
        overflow:hidden}
      .pa-bar-fill{height:100%;border-radius:999px;
        background:var(--pa-series,var(--dsw-alias-brand-primary,#3a6df0))}
      .pa-table-wrap{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:10px;
        overflow-x:auto;overflow-y:hidden;max-width:100%;
        background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04))}
      .pa-table{width:100%;border-collapse:collapse;font-size:12px}
      .pa-table th,.pa-table td{padding:6px 12px;text-align:left;white-space:nowrap;
        border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
      .pa-table thead th{font-weight:600;font-size:11px;letter-spacing:.03em;text-transform:uppercase;
        color:var(--dsw-alias-label-secondary,inherit);opacity:.9;
        background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
      .pa-table tbody tr:last-child td{border-bottom:0}
      .pa-table tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
      .pa-table .pa-num{text-align:right;font-variant-numeric:tabular-nums}
      .pa-table .pa-model{max-width:300px}
      .pa-more{display:flex;justify-content:center;margin-top:8px}
      .pa-disclosure{margin-top:8px}
      .pa-summary{cursor:pointer;font-size:11px;list-style:none;user-select:none;
        color:var(--dsw-alias-label-secondary,inherit)}
      .pa-summary::-webkit-details-marker{display:none}
      .pa-summary::before{content:"▸";display:inline-block;margin-right:5px;transition:transform .12s}
      .pa-disclosure[open]>.pa-summary::before{transform:rotate(90deg)}
      .pa-summary:hover{color:var(--dsw-alias-label-primary,inherit)}
      .pa-disclosure-body{margin:8px 0 0;line-height:1.6}
      .pa-model-cell{display:flex;align-items:center;gap:7px;min-width:0}
      .pa-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pa-share{display:flex;align-items:center;gap:7px;justify-content:flex-end}
      .pa-share-bar{width:56px;height:6px;border-radius:999px;flex:0 0 auto;overflow:hidden;
        background:var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
      .pa-share-fill{display:block;height:100%;border-radius:999px;
        background:var(--pa-series,var(--dsw-alias-brand-primary,#3a6df0))}
      .pa-share-text{min-width:46px;text-align:right;font-variant-numeric:tabular-nums}
      .pa-table tfoot td{font-weight:600;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));
        border-bottom:0;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}
      .pa-sort{font:inherit;font-size:11px;letter-spacing:.03em;text-transform:uppercase;background:none;
        border:0;padding:0;color:inherit;cursor:pointer;opacity:.9;white-space:nowrap}
      .pa-sort[data-active="1"]{color:var(--dsw-alias-brand-primary,#3a6df0);opacity:1;font-weight:700}
      .pa-sort:hover{opacity:1}
      .pa-empty{margin:0;padding:10px 2px;font-size:12px;
        color:var(--dsw-alias-label-secondary,inherit);opacity:.8}
      .pa-note{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:8px;
        border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));
        color:var(--dsw-alias-label-primary,inherit);font-size:12px;line-height:1.5}
      .pa-note-error{border-color:var(--dsw-alias-state-error-primary,#f85149);
        box-shadow:inset 3px 0 0 var(--dsw-alias-state-error-primary,#f85149)}
      .pa-note-ok{border-color:var(--dsw-alias-state-success-primary,#3fb950);
        box-shadow:inset 3px 0 0 var(--dsw-alias-state-success-primary,#3fb950)}
      .pa-warn{border-color:var(--dsw-alias-state-warn-primary,#d29922);
        box-shadow:inset 3px 0 0 var(--dsw-alias-state-warn-primary,#d29922)}
      .pa-note-body{flex:1;min-width:0;word-break:break-word}
      .pa-setup{max-width:640px;display:flex;flex-direction:column;gap:10px;padding:16px;
        border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:10px;
        background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}
      .pa-setup h3{margin:0;font-size:14px}
      .pa-setup p{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,inherit)}
      .pa-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .pa-input{flex:1;min-width:200px;padding:5px 9px;border-radius:6px;
        border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.4));background:transparent;
        color:inherit;font:inherit;outline:none}
      .pa-input:focus{border-color:var(--dsw-alias-brand-primary,#3a6df0)}
      .pa-link{color:var(--dsw-alias-brand-primary,#3a6df0);text-decoration:underline;
        text-underline-offset:2px;font-size:12px}
      .pa-link:hover{opacity:.85}
      .pa-loading{padding:24px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
      .pa-keybox{display:flex;flex-direction:column;gap:8px}
      .pa-keymeta{font-size:11px;color:var(--dsw-alias-label-secondary,inherit)}
      .pa-warn{color:var(--dsw-alias-state-warn-primary,#d29922)}
    `

    /** Похоже ли значение на отчёт: без этого неполный ответ уронил бы слот. */
    function isReport(value) {
      if (value === null || typeof value !== 'object') return false
      const periods = value.periods
      if (periods === null || typeof periods !== 'object') return false
      for (const period of [periods.today, periods.month]) {
        if (period === null || typeof period !== 'object') return false
        if (!Array.isArray(period.models)) return false
        if (period.totalMicros === undefined) return false
      }
      return value.ranges !== null && typeof value.ranges === 'object'
    }

    /** Вызов операции Host. Любой `ok:false` становится исключением. */
    async function call(op, body) {
      let response
      try {
        response = await fetch(`${API}/${op}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
          credentials: 'same-origin',
        })
      } catch (error) {
        const failure = new Error(`Host недоступен: ${error instanceof Error ? error.message : String(error)}`)
        failure.code = 'network'
        throw failure
      }
      const text = await response.text().catch(() => '')
      let payload
      try {
        payload = text.trim() === '' ? {} : JSON.parse(text)
      } catch {
        const failure = new Error(`Неожиданный ответ Host (${response.status})`)
        failure.code = 'shape'
        throw failure
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const detail = payload !== null && typeof payload === 'object' ? payload.error : undefined
        const failure = new Error(
          detail !== undefined && typeof detail.message === 'string' && detail.message !== ''
            ? detail.message
            : `Host ответил ${response.status}`,
        )
        failure.code = detail !== undefined && typeof detail.code === 'string' ? detail.code : 'unknown'
        throw failure
      }
      return payload.value
    }

    /** Знак валюты по коду; неизвестный код показывается как есть. */
    function symbolOf(currency) {
      if (typeof currency !== 'string' || currency === '') return '₽'
      const code = currency.toUpperCase()
      if (code === 'RUB') return '₽'
      if (code === 'USD') return '$'
      if (code === 'EUR') return '€'
      if (code === 'CNY') return '¥'
      if (code === 'GBP') return '£'
      return code
    }

    /** Сумма из микро в читаемую строку без валюты. */
    function amount(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      const abs = Math.abs(value)
      const maximumFractionDigits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
      return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits })
    }

    /** Сумма из микро в читаемую строку с валютой. */
    function money(micros, currency) {
      if (micros === null || micros === undefined) return '—'
      const value = Number(micros) / 1e8
      if (!Number.isFinite(value)) return '—'
      return `${amount(value)} ${symbolOf(currency)}`
    }

    /** Компактное число: 1 234, 12,3 тыс., 1,2 млн. */
    function compact(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '—'
      return number.toLocaleString('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
    }

    /** Доля в процентах с одним знаком. */
    function percent(share) {
      if (share === null || share === undefined || !Number.isFinite(share)) return '—'
      return `${(share * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`
    }

    /**
     * Цена миллиона токенов: сумма в микро делится на токены.
     * Возвращает рубли, чтобы форматировать тем же `amount`.
     */
    function perMillion(micros, tokens) {
      const value = Number(micros)
      const count = Number(tokens)
      if (!Number.isFinite(value) || !Number.isFinite(count) || count <= 0) return null
      return value / (100 * count)
    }

    /** `2026-11-20` → `20.11`. */
    function shortDay(key) {
      const parts = String(key ?? '').split('-')
      return parts.length === 3 ? `${parts[2]}.${parts[1]}` : String(key ?? '')
    }

    /** Целое с разделителями групп. */
    function count(value) {
      const number = Number(value)
      return Number.isFinite(number) ? number.toLocaleString('ru-RU') : '—'
    }

    /** Дата ISO коротко: 20.11.2026. */
    function shortDate(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU')
    }

    /** Время ISO коротко: 17:50:20. */
    function shortTime(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU')
    }

    /** Ключ строки: имя модели, а `null` — отдельная строка «без модели». */
    function modelKey(model) {
      return model === null || model === undefined ? '\u0000' : String(model)
    }

    /** Объединить модели обоих периодов в одну строку на модель. */
    function mergeModels(report) {
      const rows = new Map()
      const add = (period, models) => {
        for (const model of models) {
          const key = modelKey(model.model)
          const entry = rows.get(key) ?? { key, model: model.model ?? null, today: null, month: null }
          entry[period] = model
          rows.set(key, entry)
        }
      }
      add('today', report.periods.today.models ?? [])
      add('month', report.periods.month.models ?? [])
      return [...rows.values()]
    }

    /** Значок панели в левом столбце: три столбика расходов. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('rect', { x: 1.5, y: 9.5, width: 3, height: 5, rx: 1, fill: 'currentColor', opacity: 0.6 }),
        h('rect', { x: 6.5, y: 4.5, width: 3, height: 10, rx: 1, fill: 'currentColor' }),
        h('rect', { x: 11.5, y: 7.5, width: 3, height: 7, rx: 1, fill: 'currentColor', opacity: 0.8 }),
      )
    }

    /** Переключатель «Показать все» / «Свернуть» для длинного списка. */
    function MoreButton(props) {
      const { t, expanded, count, onToggle } = props
      if (count <= TOP_MODELS) return null
      return h(
        'div',
        { className: 'pa-more' },
        h(
          'button',
          {
            className: 'pa-btn',
            type: 'button',
            'aria-expanded': expanded ? 'true' : 'false',
            onClick: onToggle,
          },
          expanded ? t('showLess') : `${t('showAll')} · ${count}`,
        ),
      )
    }

    /** Столбчатая разбивка одного периода. */
    function Bars(props) {
      const { models, currency, t, seriesFor = () => '' } = props
      const [expanded, setExpanded] = useState(false)
      if (models.length === 0) return h('p', { className: 'pa-empty' }, t('noData'))
      // Масштаб полос считается по всему списку, чтобы ТОП-10 не «растягивался».
      const max = models.reduce((value, row) => Math.max(value, Number(row.micros) || 0), 0)
      const visible = limitRows(models, expanded)
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'pa-bars' },
          visible.map((row) => {
            const width = max > 0 ? Math.min(100, Math.max(2, Math.round((Number(row.micros) / max) * 100))) : 0
            const label = row.model ?? t('modelUnknown')
            const key = modelKey(row.model)
            return h(
              'div',
              { className: 'pa-bar', key },
              h(
                'div',
                { className: 'pa-bar-head' },
                h('span', { className: 'pa-bar-name', title: label }, label),
                h('span', { className: 'pa-bar-amount' }, money(row.micros, currency)),
              ),
              h(
                'div',
                { className: 'pa-bar-track' },
                h('div', { className: `pa-bar-fill ${seriesFor(key)}`, style: { width: `${width}%` } }),
              ),
            )
          }),
        ),
        h(MoreButton, {
          t,
          expanded,
          count: models.length,
          onToggle: () => setExpanded((value) => !value),
        }),
      )
    }

    /** Дневная полоса: столбик на каждые сутки месяца, последний — сегодня. */
    function Days(props) {
      const { days, currency } = props
      if (!Array.isArray(days) || days.length === 0) return null
      const max = days.reduce((value, day) => Math.max(value, Number(day.micros) || 0), 0)
      const todayKey = days[days.length - 1].date
      return h(
        'div',
        { className: 'pa-days' },
        days.map((day) => {
          const value = Number(day.micros) || 0
          const height = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
          const label = `${shortDay(day.date)} — ${money(day.micros, currency)}`
          return h(
            'div',
            { className: 'pa-day', key: day.date, title: label, 'aria-label': label, role: 'img' },
            h(
              'div',
              { className: 'pa-day-track' },
              h('div', {
                className: `pa-day-fill ${day.date === todayKey ? 'pa-series-2' : 'pa-series-1'}`,
                style: { height: `${height}%` },
              }),
            ),
          )
        }),
      )
    }

    /** Сколько моделей показывается до нажатия «Показать все». */
    const TOP_MODELS = 10

    /** Видимые строки таблицы: ТОП-10 или весь список после раскрытия. */
    function limitRows(rows, expanded, limit = TOP_MODELS) {
      return expanded ? rows : rows.slice(0, limit)
    }

    /** Потребность до конца месяца: прогноз минус уже потраченное за месяц. */
    function needMicrosOf(report) {
      const forecastMicros = report?.forecast?.micros ?? null
      if (forecastMicros === null) return null
      return (BigInt(forecastMicros) - BigInt(report.periods.month.totalMicros)).toString()
    }

    /** Таблица расходов: модель, оба периода, доля месяца. */
    function SpendingTable(props) {
      const { rows, report, currency, t, seriesFor = () => '' } = props
      const [expanded, setExpanded] = useState(false)
      const monthTotal = Number(report.periods.month.totalMicros) || 0
      const sorted = [...rows].sort((left, right) => Number(right.month?.micros ?? 0) - Number(left.month?.micros ?? 0))
      const visible = limitRows(sorted, expanded)
      return h(
        React.Fragment,
        null,
        h(
        'div',
        { className: 'pa-table-wrap' },
        h(
          'table',
          { className: 'pa-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col' }, t('colModel')),
              h('th', { scope: 'col', className: 'pa-num' }, t('today')),
              h('th', { scope: 'col', className: 'pa-num' }, t('month')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colShare')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colRequests')),
            ),
          ),
          h(
            'tbody',
            null,
            sorted.length === 0
              ? h('tr', null, h('td', { colSpan: 5 }, h('p', { className: 'pa-empty' }, t('noData'))))
              : visible.map((entry) => {
                  const monthMicros = Number(entry.month?.micros ?? 0)
                  const requests = entry.month?.requests ?? 0
                  const share = monthTotal > 0 ? (monthMicros / monthTotal) * 100 : null
                  return h(
                    'tr',
                    { key: entry.key },
                    h(
                      'td',
                      { className: 'pa-model', title: entry.model ?? '' },
                      h(
                        'span',
                        { className: 'pa-model-cell' },
                        h('span', { className: `pa-dot ${seriesFor(entry.key)}`, 'aria-hidden': 'true' }),
                        h('span', { className: 'pa-model-name' }, entry.model ?? t('modelUnknown')),
                      ),
                    ),
                    h('td', { className: 'pa-num' }, money(entry.today?.micros ?? null, currency)),
                    h('td', { className: 'pa-num' }, money(entry.month?.micros ?? null, currency)),
                    h(
                      'td',
                      { className: 'pa-num' },
                      share === null
                        ? '—'
                        : h(
                            'span',
                            { className: 'pa-share' },
                            h(
                              'span',
                              { className: 'pa-share-bar', 'aria-hidden': 'true' },
                              h('span', {
                                className: `pa-share-fill ${seriesFor(entry.key)}`,
                                style: { width: `${Math.min(100, Math.max(0, share))}%` },
                              }),
                            ),
                            h(
                              'span',
                              { className: 'pa-share-text' },
                              `${share.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`,
                            ),
                          ),
                    ),
                    h('td', { className: 'pa-num' }, requests === 0 ? '—' : count(requests)),
                  )
                }),
          ),
          h(
            'tfoot',
            null,
            h(
              'tr',
              null,
              h('td', null, t('totalRow')),
              h('td', { className: 'pa-num' }, money(report.periods.today.totalMicros, currency)),
              h('td', { className: 'pa-num' }, money(report.periods.month.totalMicros, currency)),
              h('td', { className: 'pa-num' }, monthTotal > 0 ? '100 %' : '—'),
              h('td', { className: 'pa-num' }, count(report.periods.month.requests)),
            ),
          ),
        ),
        ),
        h(MoreButton, { t, expanded, count: sorted.length, onToggle: () => setExpanded((value) => !value) }),
      )
    }

    /**
     * Скорость выхода модели: токены ответа на суммарное время запросов.
     * Возвращает -1, когда считать нечего, — такие строки уходят в конец.
     */
    function speedOf(entry) {
      const month = entry.month
      const latency = month?.avgLatency ?? null
      const requests = month?.requests ?? 0
      if (month == null || latency === null || !(latency > 0) || !(requests > 0)) return -1
      return (month.completionTokens ?? 0) / (requests * latency)
    }

    /**
     * Среднее время ответа модели — то, сколько вы реально ждёте.
     * Без данных — в конец списка.
     */
    function meanLatencyOf(entry) {
      const value = entry.month?.avgLatency
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY
    }

    /** Сравнение чисел, при котором Infinity равен Infinity (разность дала бы NaN). */
    function compareNumbers(left, right) {
      if (left === right) return 0
      return left < right ? -1 : 1
    }

    /**
     * Эталонное время обработки миллиона токенов и вес времени в балле.
     *
     * Балл = цена миллиона токенов × (время ÷ эталон)^вес. При весе 2 модель,
     * которая вдвое медленнее эталона, получает вчетверо больший балл — то есть
     * поднимается выше только если она вчетверо дешевле. Вес подобран так,
     * чтобы медленная модель не обходила быструю за счёт одной дешевизны.
     */
    const RANKING_REFERENCE_SECONDS = 60
    const RANKING_TIME_WEIGHT = 2

    /**
     * Цена миллиона токенов, пересчитанная на эталонное время обработки.
     *
     * Считается на единицу работы, поэтому размер контекста балл почти не
     * искажает: модель с длинными сессиями не выглядит хуже из-за объёма.
     * Меньше — лучше; без данных — в конец списка.
     */
    function adjustedCostOf(entry) {
      const month = entry.month
      const latency = month?.avgLatency ?? null
      const requests = month?.requests ?? 0
      const tokens = (month?.promptTokens ?? 0) + (month?.completionTokens ?? 0)
      if (month == null || tokens <= 0 || !(requests > 0) || latency === null || !(latency > 0)) {
        return Number.POSITIVE_INFINITY
      }
      const rubPerMillion = (Number(month.micros ?? 0) / 100000000 / tokens) * 1000000
      const secondsPerMillion = (latency * requests * 1000000) / tokens
      return rubPerMillion * Math.pow(secondsPerMillion / RANKING_REFERENCE_SECONDS, RANKING_TIME_WEIGHT)
    }

    /**
     * Пороги честного сравнения. Модель с одним-двумя запросами даёт случайную
     * картину; модель с высокой долей ошибок быстро обрывается и выглядит
     * быстрой только потому, что не доработала.
     */
    const RANKING_MIN_REQUESTS = 5
    const RANKING_MAX_ERROR_SHARE = 0.2

    /**
     * Можно ли ранжировать модель по «цене × времени». Возвращает причину
     * отказа, если нельзя, либо null.
     */
    function excludedReason(entry) {
      const month = entry.month
      if (month == null || !(month.requests > 0)) return 'noRequests'
      if (month.requests < RANKING_MIN_REQUESTS) return 'fewRequests'
      if (month.requests > 0 && month.errors / month.requests > RANKING_MAX_ERROR_SHARE) return 'highErrors'
      if (!(Number(month.micros) > 0)) return 'noSpending'
      return null
    }

    /** Строки, которые попадают в рейтинг, и строки, которые в него не входят. */
    function splitForRanking(rows) {
      const ranked = []
      const excluded = []
      for (const entry of rows) {
        const reason = excludedReason(entry)
        if (reason === null) ranked.push(entry)
        else excluded.push({ entry, reason })
      }
      return { ranked, excluded }
    }

    /** Строки таблицы эффективности: от лучшей по цене с поправкой на время. */
    function sortByAdjustedCostAsc(rows) {
      return [...rows].sort((left, right) => {
        const byScore = compareNumbers(adjustedCostOf(left), adjustedCostOf(right))
        if (byScore !== 0) return byScore
        return compareNumbers(meanLatencyOf(left), meanLatencyOf(right))
      })
    }

    /** Строки профиля задержек: от быстрых к медленным, при равенстве — по числу запросов. */
    function sortByMedianAsc(models) {
      return [...models].sort((left, right) => {
        const byMedian = compareNumbers(
          left.medianLatency ?? Number.POSITIVE_INFINITY,
          right.medianLatency ?? Number.POSITIVE_INFINITY,
        )
        if (byMedian !== 0) return byMedian
        return right.samples - left.samples
      })
    }

    /** Эффективность за месяц: токены, цена миллиона, кеш, ошибки, задержка. */
    function EfficiencyTable(props) {
      const { rows, currency, t, seriesFor = () => '' } = props
      const { ranked, excluded } = splitForRanking(rows)
      const sorted = sortByAdjustedCostAsc(ranked)
      const unit = symbolOf(currency)
      return h(
        'div',
        { className: 'pa-table-wrap' },
        h(
          'table',
          { className: 'pa-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col' }, t('colModel')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colScore')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colTokens')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colReasoning')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colPerMillion')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colCache')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colErrors')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colLatency')),
              h('th', { scope: 'col', className: 'pa-num' }, t('colSpeed')),
            ),
          ),
          h(
            'tbody',
            null,
            sorted.length === 0
              ? h('tr', null, h('td', { colSpan: 9 }, h('p', { className: 'pa-empty' }, t('noData'))))
              : sorted.map((entry) => {
                  const month = entry.month ?? null
                  const tokens = month === null ? 0 : (month.promptTokens ?? 0) + (month.completionTokens ?? 0)
                  const price = month === null ? null : perMillion(month.micros, tokens)
                  const cache = month !== null && month.promptTokens > 0 ? month.cachedTokens / month.promptTokens : null
                  const failures = month !== null && month.requests > 0 ? month.errors / month.requests : null
                  const latency = month?.avgLatency ?? null
                  const output = month?.completionTokens ?? 0
                  // Сумма токенов, делённая на сумму времён: средняя задержка
                  // умножается на число запросов, поэтому дробь точна.
                  const speed =
                    latency !== null && latency > 0 && (month?.requests ?? 0) > 0
                      ? output / (month.requests * latency)
                      : null
                  return h(
                    'tr',
                    { key: entry.key },
                    h(
                      'td',
                      { className: 'pa-model', title: entry.model ?? '' },
                      h(
                        'span',
                        { className: 'pa-model-cell' },
                        h('span', { className: `pa-dot ${seriesFor(entry.key)}`, 'aria-hidden': 'true' }),
                        h('span', { className: 'pa-model-name' }, entry.model ?? t('modelUnknown')),
                      ),
                    ),
                    h(
                      'td',
                      { className: 'pa-num' },
                      Number.isFinite(adjustedCostOf(entry)) ? `${amount(adjustedCostOf(entry))} ${unit}` : '—',
                    ),
                    h(
                      'td',
                      { className: 'pa-num' },
                      month !== null && (month.requests ?? 0) > 0 && tokens > 0
                        ? compact(tokens / month.requests)
                        : '—',
                    ),
                    h(
                      'td',
                      { className: 'pa-num' },
                      month !== null && (month.requests ?? 0) > 0 && (month.reasoningTokens ?? 0) > 0
                        ? compact(month.reasoningTokens / month.requests)
                        : '—',
                    ),
                    h('td', { className: 'pa-num' }, price === null ? '—' : `${amount(price)} ${unit}`),
                    h('td', { className: 'pa-num' }, percent(cache)),
                    h('td', { className: 'pa-num' }, percent(failures)),
                    h(
                      'td',
                      { className: 'pa-num' },
                      latency === null
                        ? '—'
                        : `${latency.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${t('unitSeconds')}`,
                    ),
                    h(
                      'td',
                      { className: 'pa-num' },
                      speed === null
                        ? '—'
                        : `${speed.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${t('unitTokensPerSecond')}`,
                    ),
                  )
                }),
          ),
        ),
        excluded.length === 0
          ? null
          : h(
              'details',
              { className: 'pa-disclosure' },
              h('summary', { className: 'pa-summary' }, `${t('notRankedTitle')} · ${excluded.length}`),
              h(
                'p',
                { className: 'pa-keymeta pa-disclosure-body' },
                excluded
                  .map(({ entry, reason }) => `${entry.model ?? t('modelUnknown')} (${t(EXCLUSION_LABELS[reason])})`)
                  .join(', '),
              ),
            ),
      )
    }

    /** Подписи причин, по которым модель не попала в рейтинг. */
    const EXCLUSION_LABELS = {
      noRequests: 'reasonNoRequests',
      fewRequests: 'reasonFewRequests',
      highErrors: 'reasonHighErrors',
      noSpending: 'reasonNoSpending',
    }

    /** Карточка «ключ не настроен» / управление ключом. */
    function KeyForm(props) {
      const { t, status, onSaved, compact } = props
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState(null)
      const [confirming, setConfirming] = useState(false)
      // Ключ не удаляется с первого щелчка: это дорогая операция, а кнопка
      // стоит вплотную к «Сохранить».
      useEffect(() => {
        if (!confirming) return undefined
        const handle = setTimeout(() => setConfirming(false), 4000)
        return () => clearTimeout(handle)
      }, [confirming])
      // `removable` появился позже `writable`: если Host ещё старой версии,
      // ключ из хранилища всё равно считается удаляемым.
      const canRemove = status?.removable === true || (status?.removable === undefined && status?.source === 'store')
      const sourceLabel =
        status?.source === 'store'
          ? t('keySourceStore')
          : status?.source === 'environment'
            ? t('keySourceEnvironment')
            : status?.source === 'config'
              ? t('keySourceConfig')
              : null

      const save = async (event) => {
        event.preventDefault()
        const token = draft.trim()
        if (token === '' || busy) return
        setBusy(true)
        setNote(null)
        try {
          await call('key', { token })
          setDraft('')
          setNote({ ok: true, text: t('keySaved') })
          onSaved?.()
        } catch (failure) {
          setNote({ ok: false, text: failure.message })
        } finally {
          setBusy(false)
        }
      }

      const forget = async () => {
        if (busy) return
        if (!confirming) {
          setNote(null)
          setConfirming(true)
          return
        }
        setConfirming(false)
        setBusy(true)
        setNote(null)
        try {
          await call('key', { clear: true })
          setNote({ ok: true, text: t('keyCleared') })
          onSaved?.()
        } catch (failure) {
          setNote({ ok: false, text: failure.message })
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: compact ? 'pa-keybox' : 'pa-setup' },
        compact ? null : h('h3', null, t('setupTitle')),
        compact ? null : h('p', null, t('setupHint')),
        compact && sourceLabel !== null
          ? h('div', { className: 'pa-keymeta' }, `${t('keySource')}: ${sourceLabel}`)
          : null,
        h(
          'form',
          { className: 'pa-form', onSubmit: save },
          h('input', {
            className: 'pa-input',
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            value: draft,
            placeholder: t('keyPlaceholder'),
            onChange: (event) => setDraft(event.target.value),
            'aria-label': t('keyPlaceholder'),
          }),
          h(
            'button',
            { className: 'pa-btn pa-btn-primary', type: 'submit', disabled: busy || draft.trim() === '' },
            busy ? t('keySaving') : t('keySave'),
          ),
          status?.configured === true && canRemove
            ? h(
                'button',
                { className: 'pa-btn', type: 'button', disabled: busy, onClick: forget },
                confirming ? t('keyForgetConfirm') : t('keyForget'),
              )
            : null,
        ),
        status?.configured === true && !canRemove
          ? h('div', { className: 'pa-keymeta pa-warn' }, t('keyReadOnly'))
          : null,
        note === null
          ? null
          : h('div', { className: `pa-note ${note.ok ? 'pa-note-ok' : 'pa-note-error'}` },
              h('div', { className: 'pa-note-body' }, note.text)),
        compact
          ? null
          : h(
              'div',
              { className: 'pa-form' },
              h('a', { className: 'pa-link', href: CABINET_URL, target: '_blank', rel: 'noreferrer' }, t('keyCabinet')),
              h('a', { className: 'pa-link', href: DOCS_URL, target: '_blank', rel: 'noreferrer' }, t('docs')),
            ),
      )
    }

    /** Страница расходов целиком. */
    function AnalyticsPage(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackText
      const [status, setStatus] = useState(null)
      const [report, setReport] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState(null)
      const [tick, setTick] = useState(0)
      const [showKey, setShowKey] = useState(false)

      useEffect(() => {
        let cancelled = false
        setPhase('loading')
        setError(null)
        const run = async () => {
          try {
            const info = await call('status')
            if (cancelled) return
            setStatus(info)
            if (info.configured !== true) {
              setReport(null)
              setPhase('ready')
              return
            }
            const data = await call('report')
            if (cancelled) return
            if (!isReport(data)) {
              const failure = new Error('Host вернул неполный отчёт о расходах')
              failure.code = 'shape'
              throw failure
            }
            setReport(data)
            setPhase('ready')
          } catch (failure) {
            if (cancelled) return
            setError({ code: failure.code ?? 'unknown', message: failure.message })
            setPhase('error')
          }
        }
        run()
        return () => {
          cancelled = true
        }
      }, [tick])

      const refresh = useCallback(() => setTick((value) => value + 1), [])
      const merged = useMemo(() => (report == null ? [] : mergeModels(report)), [report])
      const currency = report?.currency ?? null
      // Цвет серии — ранг модели по расходам за месяц: одна и та же модель
      // получает один цвет в обеих диаграммах и обеих таблицах.
      const seriesFor = useMemo(() => {
        const order = [...merged].sort(
          (left, right) =>
            Number(right.month?.micros ?? 0) - Number(left.month?.micros ?? 0) ||
            Number(right.today?.micros ?? 0) - Number(left.today?.micros ?? 0),
        )
        const ranks = new Map()
        order.forEach((entry, position) => ranks.set(entry.key, position % 8))
        return (key) => `pa-series-${(ranks.get(key) ?? 0) + 1}`
      }, [merged])

      // Дневная полоса и прогноз приходят от новой половины Host; у старой
      // их нет — тогда блоки просто не рисуются.
      const days = Array.isArray(report?.daily?.days) ? report.daily.days : []
      const forecast = report?.forecast ?? null
      const averageDay =
        report == null || days.length === 0
          ? null
          : String(Math.round(Number(report.periods.month.totalMicros) / days.length))
      const balance = report?.balance ?? null
      const needMicros = report == null ? null : needMicrosOf(report)
      const balanceReserved = balance !== null && Number(balance.reservedMicros ?? 0) > 0
        ? money(balance.reservedMicros, currency)
        : null
      const hasEfficiency = merged.some(
        (entry) =>
          entry.month != null &&
          (entry.month.promptTokens !== undefined ||
            entry.month.errors !== undefined ||
            entry.month.avgLatency !== undefined),
      )

      const content = (() => {
        if (phase === 'error') {
          const keyBroken = error?.code === 'unauthorized' || error?.code === 'forbidden' || error?.code === 'no-key'
          return h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'pa-note pa-note-error' },
              h(
                'div',
                { className: 'pa-note-body' },
                h('div', null, h('b', null, `${t('errorTitle')}: `), error?.message ?? ''),
                h(
                  'div',
                  { className: 'pa-form', style: { marginTop: '10px' } },
                  h('button', { className: 'pa-btn', type: 'button', onClick: refresh }, t('retry')),
                  keyBroken
                    ? h(
                        'button',
                        { className: 'pa-btn', type: 'button', onClick: () => setShowKey(true) },
                        t('changeKey'),
                      )
                    : null,
                ),
              ),
            ),
            keyBroken && showKey ? h(KeyForm, { t, status, onSaved: refresh, compact: true }) : null,
          )
        }
        if (status !== null && status.configured !== true) {
          return h(KeyForm, { t, status, onSaved: refresh })
        }
        if (report == null) {
          return h('div', { className: 'pa-loading' }, t('loading'))
        }
        return h(
          React.Fragment,
          null,
          showKey ? h(KeyForm, { t, status, onSaved: refresh, compact: true }) : null,
          report.truncated === true
            ? h('div', { className: 'pa-note pa-warn' }, h('div', { className: 'pa-note-body' }, t('truncated')))
            : null,
          h(
            'div',
            { className: 'pa-cards' },
            h(
              'div',
              { className: 'pa-card pa-series-1' },
              h('div', { className: 'pa-card-label' }, t('today')),
              h(
                'div',
                { className: 'pa-card-value', title: money(report.periods.today.totalMicros, currency) },
                money(report.periods.today.totalMicros, currency),
              ),
              h(
                'div',
                { className: 'pa-card-foot' },
                `${t('requests')}: ${count(report.periods.today.requests)} · ${t('rangeFrom')} ${shortDate(report.ranges.today.start)}`,
              ),
            ),
            h(
              'div',
              { className: 'pa-card pa-series-2' },
              h('div', { className: 'pa-card-label' }, t('month')),
              h(
                'div',
                { className: 'pa-card-value', title: money(report.periods.month.totalMicros, currency) },
                money(report.periods.month.totalMicros, currency),
              ),
              h(
                'div',
                { className: 'pa-card-foot' },
                `${t('requests')}: ${count(report.periods.month.requests)} · ${t('rangeFrom')} ${shortDate(report.ranges.month.start)}`,
              ),
            ),
            forecast === null || forecast === undefined
              ? null
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'pa-card pa-series-3' },
                    h('div', { className: 'pa-card-label' }, t('forecastCard')),
                    h(
                      'div',
                      {
                        className: 'pa-card-value',
                        title: forecast.micros == null ? '' : money(forecast.micros, currency),
                      },
                      forecast.micros == null ? '—' : money(forecast.micros, currency),
                    ),
                    h(
                      'div',
                      { className: 'pa-card-foot' },
                      forecast.micros == null
                        ? t('forecastNoData')
                        : `${t('forecastFoot')} · ${count(forecast.daysInMonth)} ${t('daysUnit')}`,
                    ),
                  ),
                  h(
                    'div',
                    { className: 'pa-card pa-series-5' },
                    h('div', { className: 'pa-card-label' }, t('needCard')),
                    h(
                      'div',
                      {
                        className: 'pa-card-value',
                        title: needMicros === null ? '' : money(needMicros, currency),
                      },
                      needMicros === null ? '—' : money(needMicros, currency),
                    ),
                    h(
                      'div',
                      { className: 'pa-card-foot' },
                      needMicros === null ? t('forecastNoData') : t('needFoot'),
                    ),
                  ),
                ),
            h(
              'div',
              { className: 'pa-card pa-series-4' },
              h('div', { className: 'pa-card-label' }, t('balanceCard')),
              h(
                'div',
                {
                  className: 'pa-card-value',
                  title: balance === null ? '' : money(balance.availableMicros, currency),
                },
                balance === null ? '—' : money(balance.availableMicros, currency),
              ),
              h(
                'div',
                { className: 'pa-card-foot' },
                balance === null
                  ? t('balanceUnavailable')
                  : balance.approximate === true
                    ? t('balanceApproximate')
                    : balanceReserved === null
                      ? t('balanceFoot')
                      : `${t('balanceReserved')}: ${balanceReserved}`,
              ),
            ),
          ),
          days.length > 0
            ? h(
                'section',
                { className: 'pa-section' },
                h(
                  'div',
                  { className: 'pa-section-head' },
                  h('h2', { className: 'pa-section-title' }, t('dailyTitle')),
                  h(
                    'p',
                    { className: 'pa-section-hint' },
                    `${t('averageDay')}: ${money(averageDay, currency)} · ${t('rangeFrom')} ${shortDate(report.daily.start)}`,
                  ),
                ),
                h('div', { className: 'pa-days-card' }, h(Days, { days, currency })),
              )
            : null,
          h(
            'section',
            { className: 'pa-section' },
            h(
              'div',
              { className: 'pa-section-head' },
              h('h2', { className: 'pa-section-title' }, t('breakdownTitle')),
              h('p', { className: 'pa-section-hint' }, t('breakdownHint')),
            ),
            h(
              'div',
              { className: 'pa-charts' },
              h(
                'div',
                { className: 'pa-chart' },
                h(
                  'div',
                  { className: 'pa-chart-title' },
                  h('span', { className: 'pa-dot pa-series-1', 'aria-hidden': 'true' }),
                  `${t('today')} · ${money(report.periods.today.totalMicros, currency)}`,
                ),
                h(Bars, { models: report.periods.today.models ?? [], currency, t, seriesFor }),
              ),
              h(
                'div',
                { className: 'pa-chart' },
                h(
                  'div',
                  { className: 'pa-chart-title' },
                  h('span', { className: 'pa-dot pa-series-2', 'aria-hidden': 'true' }),
                  `${t('month')} · ${money(report.periods.month.totalMicros, currency)}`,
                ),
                h(Bars, { models: report.periods.month.models ?? [], currency, t, seriesFor }),
              ),
            ),
            h(SpendingTable, { rows: merged, report, currency, t, seriesFor }),
          ),
          hasEfficiency
            ? h(
                'section',
                { className: 'pa-section' },
                h(
                  'div',
                  { className: 'pa-section-head' },
                  h('h2', { className: 'pa-section-title' }, t('efficiencyTitle')),
                  h('p', { className: 'pa-section-hint' }, t('efficiencyHint')),
                ),
                h(EfficiencyTable, { rows: merged, currency, t, seriesFor }),
              )
            : null,
        )
      })()

      return h(
        'div',
        { className: 'pa-root' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h(
          'div',
          { className: 'pa-head' },
          h(
            'div',
            { className: 'pa-head-text' },
            h('div', { className: 'pa-head-title' }, t('title')),
            h(
              'div',
              { className: 'pa-head-sub' },
              report == null
                ? t('subtitle')
                : `${t('updatedAt')} ${shortTime(report.generatedAt)} · ${t('subtitle')}`,
            ),
          ),
          h('div', { className: 'pa-spacer' }),
          h(
            'button',
            { className: 'pa-btn', type: 'button', onClick: refresh, disabled: phase === 'loading' },
            phase === 'loading' ? t('loading') : t('refresh'),
          ),
          status?.configured === true || phase === 'error'
            ? h(
                'button',
                {
                  className: 'pa-btn',
                  type: 'button',
                  'data-active': showKey ? '1' : '0',
                  'aria-expanded': showKey ? 'true' : 'false',
                  onClick: () => setShowKey((value) => !value),
                },
                showKey ? t('keyHide') : t('key'),
              )
            : null,
        ),
        h('div', { className: 'pa-scroll' }, h('div', { className: 'pa-content' }, content)),
      )
    }

    return {
      inject: ['slots', 'locale'],
      helpers: {
        speedOf,
        meanLatencyOf,
        adjustedCostOf,
        excludedReason,
        splitForRanking,
        sortByAdjustedCostAsc,
        sortByMedianAsc,
        limitRows,
        needMicrosOf,
        TOP_MODELS,
      },
      apply(ctx) {
        const t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : fallbackText
        if (typeof ctx.locale?.register === 'function') {
          for (const locale of LOCALE_IDS) {
            const dictionary = COPY[locale] ?? COPY.en
            ctx.effect(() => ctx.locale.register(NS, locale, dictionary), `provod-analytics: ${locale}`)
          }
        }
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              locale: NS,
              label: () => t('panel'),
            },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            AnalyticsPage,
          ),
        )
      },
    }
  },
})
