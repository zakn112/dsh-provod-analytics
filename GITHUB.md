# Установка через GitHub (без npm)

Плагин публикуется прямо в GitHub-репозитории. npm и GitHub Pages не нужны: DSH
ставит бандл из git-источника, закреплённого на коммите, а индекс маркета
(`index.json`) workflow коммитит в ветку, откуда его читает
`raw.githubusercontent.com`.

Схема:

```text
GitHub-репозиторий (плагин в корне)
   │  push в main
   ▼
GitHub Actions: scripts/generate-index.mjs --out index.json
   │  коммит index.json, закреплённый на SHA запушенного коммита
   ▼
raw.githubusercontent.com/<owner>/<repo>/main/index.json
   │  этот URL добавляется в DSH как источник маркета
   ▼
Plugins → Discover → Install  (или install_bundle со git-спецификацией)
```

Индекс закрепляет установку на SHA коммита: содержимое ветки не может подменить
уже опубликованную версию, для нового кода нужен новый коммит и новая запись
версии.

## Шаг 1. Репозиторий

Репозиторий должен быть **публичным**: `raw.githubusercontent.com` и анонимный git
не отдают приватный код без учётных данных, а загрузчик индекса их не передаёт.

Содержимое каталога `dsh-provod-analytics` кладётся в **корень** репозитория
(`package.json` плагина — в корне):

```text
<репозиторий>/
  package.json          ← name: dsh-provod-analytics
  index.js
  client.js
  cordis.patch.yml
  lib/
  locale/
  docs/
  scripts/generate-index.mjs
  .github/workflows/update-index.yml
```

Перед первым коммитом замените заглушку `your-org` в `package.json`
(`homepage`, `repository.url`, `bugs.url`) на реальные `<owner>/<repo>`: по этим
полям страница плагина строит ссылки. На установку из git они не влияют — индекс
берёт адрес из самого репозитория.

```sh
git init
git add .
git commit -m "dsh-provod-analytics 0.1.0"
git branch -M main
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

## Шаг 2. Индекс

Первый же push запускает **Actions → Update plugin index**. Workflow генерирует
`index.json` и коммитит его обратно в `main` (коммит бота с `[skip ci]`), поэтому
руками ничего создавать не нужно.

URL индекса:

```text
https://raw.githubusercontent.com/<owner>/<repo>/main/index.json
```

Ожидаемое содержимое: `"format": 1`, запись `"name": "dsh-provod-analytics"` и
`"source": {"type": "git", ...}` с 40-символьным `commit`.

Проверка локально, без GitHub:

```sh
node scripts/generate-index.mjs --repo <owner>/<repo> --commit "$(git rev-parse HEAD)" --out index.json
```

Скрипт проверяет имя пакета, SemVer версии, полный SHA и https-адрес иконки,
поэтому неверный документ не попадёт в ветку.

Если `raw` ещё отдаёт старую версию — это кэш CDN (до 5 минут); добавьте к URL
`?v=<sha>` только для ручной проверки, в настройках DSH оставляйте чистый URL.

## Шаг 3. Установка в DSH

### Вариант A. Через Discover

**Plugins → Discover** → добавить источник индекса → вставить URL из шага 2 →
найти «Расходы Provod» → **Install**.

### Вариант B. Напрямую тем же установщиком

`plugin_manager` принимает git-спецификацию, закреплённую на коммите (её печатает
`generate-index.mjs`):

```text
plugin_manager action=install_bundle
target=git+https://github.com/<owner>/<repo>.git#<40-символьный SHA>
```

Ожидаемо: `"application": "applied"` и пустой `warnings`; в `list_bundles`
источник станет `git+https://github.com/...`.

Последний SHA ветки:

```sh
git ls-remote https://github.com/<owner>/<repo>.git refs/heads/main
```

### Вариант C. Тарбол из GitHub Release

К релизу можно приложить архив `npm pack` и ставить его ссылкой на `.tgz`. Индекс
маркета для этого не нужен, установка остаётся штатной.

## Обновление версии

1. Поднимите `version` в `package.json` (например, `0.1.1`).
2. Закоммитьте и запушьте в `main`.
3. Workflow закоммитит новый `index.json`, закреплённый на новом коммите.
4. В DSH установите заново (вариант A или B с новым SHA).

Старые версии индекс не хранит: он описывает одну актуальную версию, чего
достаточно для установки и обновления.

## Ограничения

- **Приватный репозиторий.** `raw` и анонимный git недоступны без учётных данных,
  а загрузчик индекса их не передаёт. Для приватного кода — `.tgz` из релиза или
  собственный статический хостинг индекса.
- **URL индекса — точный, без редиректов.** Загрузчик запрещает редиректы, поэтому
  не указывайте путь к каталогу вместо `.../index.json`.
- **Ключ Provod.** Публикация плагина не публикует ключ: он вводится в самой панели
  и хранится в хранилище учётных данных DSH (см. `INSTALL.md`, шаг 4).
- **Actions.** Если Actions в репозитории отключены, `index.json` можно
  сгенерировать локально и закоммитить вручную — формат тот же.
