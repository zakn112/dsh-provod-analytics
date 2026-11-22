# Установка через GitHub (без npm)

Плагин можно публиковать прямо в GitHub-репозитории. npm для этого не нужен: DSH умеет
ставить бандл из git-источника, закреплённого на конкретном коммите, а индекс маркета
(файл `index.json`) раздаётся с GitHub Pages.

Схема:

```text
GitHub-репозиторий (плагин в корне)
   │  push в main
   ▼
GitHub Actions: scripts/generate-index.mjs → dist/index.json
   │  коммит закреплён в source.commit
   ▼
GitHub Pages: https://<owner>.github.io/<repo>/index.json
   │  этот URL добавляется в DSH как источник маркета
   ▼
Plugins → Discover → Install  (или install_bundle со git-спецификацией)
```

Индекс закрепляет установку на SHA коммита, поэтому содержимое ветки не может
подменить уже опубликованную версию: чтобы установить другой код, нужен новый коммит
и новая запись версии.

## Шаг 1. Создать репозиторий

Репозиторий должен быть **публичным**: DSH скачивает пакет из git, а анонимный доступ
к приватному репозиторию не гарантирован; GitHub Pages для приватных репозиториев на
бесплатном плане недоступны.

Содержимое каталога `dsh-provod-analytics` кладётся в **корень** репозитория (в корне
должен лежать `package.json` плагина):

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
  .github/workflows/publish-index.yml
```

```sh
cd dsh-provod-analytics
git init
git add .
git commit -m "dsh-provod-analytics 0.1.0"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Перед первым коммитом замените заглушку `your-org` в `package.json`
(`homepage`, `repository.url`, `bugs.url`) на реальные `<owner>/<repo>`: по этим
полям npm и страница плагина строят ссылки. На установку из git они не влияют —
индекс берёт адрес из самого репозитория.

## Шаг 2. Включить GitHub Pages

В репозитории: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Больше ничего настраивать не нужно: workflow сам соберёт артефакт.

## Шаг 3. Дождаться сборки индекса

Вкладка **Actions → Publish plugin index**. Успешный запуск публикует
`https://<owner>.github.io/<repo>/index.json`.

Проверка индекса локально (без GitHub):

```sh
node scripts/generate-index.mjs --repo <owner>/<repo> --commit "$(git rev-parse HEAD)" --out dist/index.json
```

Скрипт сам проверяет имя пакета, SemVer версии, 40-символьный SHA и https-адрес
иконки, поэтому неверный документ не будет опубликован.

Проверка опубликованного файла:

```sh
curl -s https://<owner>.github.io/<repo>/index.json
```

Ожидаемо: `"format": 1`, запись `"name": "dsh-provod-analytics"` и `"source": {"type": "git", ...}`.

## Шаг 4. Установить в DSH

### Вариант A. Через Discover (если в сборке есть вкладка Discover)

**Plugins → Discover** → добавить источник индекса → вставить
`https://<owner>.github.io/<repo>/index.json` → найти «Расходы Provod» → **Install**.

### Вариант B. Напрямую, тем же установщиком плагинов

Это стандартный `plugin_manager`, который использует и интерфейс. Нужна спецификация
git с полным SHA (её же печатает `generate-index.mjs`):

```text
plugin_manager action=install_bundle
target=git+https://github.com/<owner>/<repo>.git#<40-символьный SHA>
```

Ожидаемый результат: `"application": "applied"` и пустой `warnings`. После установки
в `list_bundles` у записи будет `source` вида `git+https://github.com/...` — это
подтверждает, что код взят из репозитория, а не из локального каталога.

Если SHA неизвестен, возьмите последний коммит ветки:

```sh
git ls-remote https://github.com/<owner>/<repo>.git refs/heads/main
```

### Вариант C. Тарбол из GitHub Release

К релизу можно приложить `npm pack`-архив и указывать в `install_bundle` прямую
ссылку на `.tgz`. Это не даёт индекса маркета, но установка остаётся штатной.

## Обновление версии

1. Поднимите `version` в `package.json` (например, `0.1.1`).
2. Закоммитьте и запушьте в `main`.
3. Workflow пересоберёт индекс уже с новым коммитом и версией.
4. В DSH установите заново (вариант A или B с новым SHA) — обновление идёт через
   тот же `install_bundle`.

Старые версии индекс не хранит: он описывает одну актуальную версию, чего достаточно
для установки и обновления.

## Ограничения

- **Приватный репозиторий.** Установка из git потребует, чтобы у процесса DSH были
  учётные данные GitHub, а Pages недоступны на бесплатном плане. Для приватного кода
  проще собрать `.tgz` и ставить им, либо раздать `index.json` с любого статического
  хостинга.
- **Индекс — это JSON по https-URL без редиректов.** Не указывайте путь к каталогу:
  `.../repo` вместо `.../repo/index.json` может ответить 301, а загрузчик индекса
  редиректы запрещает.
- **Ключ Provod.** Публикация плагина не публикует ключ: ключ вводится в самой панели
  и хранится в хранилище учётных данных DSH (см. `INSTALL.md`, шаг 4).
