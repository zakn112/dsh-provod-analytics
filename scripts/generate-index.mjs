#!/usr/bin/env node
/**
 * Build a DSH plugin-market index (format 1) for this package from its git repository.
 *
 * The index pins the plugin to one commit, so a stale branch cannot change what
 * users install. GitHub Actions runs this on every push; it can also be run by
 * hand to check the output.
 *
 *   node scripts/generate-index.mjs --repo owner/repo --commit <40-hex> --out dist/index.json
 *
 * Every argument falls back to the environment: --repo to GITHUB_REPOSITORY,
 * --commit to GITHUB_SHA, then to `git rev-parse HEAD`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Read `--name value` or `--name=value` from argv. */
function argument(name) {
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === `--${name}`) return argv[index + 1];
    if (item.startsWith(`--${name}=`)) return item.slice(name.length + 3);
  }
  return undefined;
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:\d*[a-zA-Z-][0-9a-zA-Z-]*|0|[1-9]\d*)(?:\.(?:\d*[a-zA-Z-][0-9a-zA-Z-]*|0|[1-9]\d*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function fail(message) {
  console.error(`generate-index: ${message}`);
  process.exit(1);
}

const repository = (argument('repo') ?? process.env.GITHUB_REPOSITORY ?? '').trim();
if (!REPOSITORY.test(repository)) {
  fail('--repo (or GITHUB_REPOSITORY) must be "owner/repo"');
}

const commit = (argument('commit') ?? process.env.GITHUB_SHA ?? gitHead()).trim().toLowerCase();
if (!COMMIT.test(commit)) fail('--commit (or GITHUB_SHA) must be a full 40-hex commit SHA');

const out = resolve(root, argument('out') ?? 'dist/index.json');

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const name = manifest.name;
const version = manifest.version;
const description = typeof manifest.description === 'string' ? manifest.description : '';

if (!PACKAGE_NAME.test(name)) fail(`package.json name is not a valid npm package name: ${name}`);
if (!SEMVER.test(version)) fail(`package.json version is not an exact SemVer version: ${version}`);

const homepage = `https://github.com/${repository}`;
const icon = `https://raw.githubusercontent.com/${repository}/${commit}/icon.svg`;
const publishTimestamp = Math.floor(Date.now() / 1000);

const index = {
  format: 1,
  title: { en: 'Provod plugins', ru: 'Плагины Provod' },
  plugins: [
    {
      name,
      title: { en: 'Provod spending', ru: 'Расходы Provod' },
      description: {
        en: 'Provod workspace spending panel: today and month-to-date totals, month-end forecast, spending by day, per-model costs, model efficiency and latency.',
        ru: 'Панель расходов рабочего пространства Provod: итоги за сегодня и с начала месяца, прогноз, расходы по дням, стоимость по моделям, эффективность и задержки моделей.',
      },
      icon,
      homepage,
      repository: { url: homepage },
      versions: [
        {
          version,
          publishTimestamp,
          source: { type: 'git', url: homepage, commit },
          engines: { dsh: '>=0.2.2-rc.5' },
        },
      ],
    },
  ],
};

// Reject an obviously broken document before Pages serves it.
if (index.format !== 1) fail('format must be 1');
if (!Array.isArray(index.plugins) || index.plugins.length === 0) fail('plugins must be non-empty');
if (!/^https:\/\//u.test(icon)) fail('icon must be an https URL');
if (description.length === 0) console.warn('generate-index: package.json has no description');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(index, undefined, 2)}\n`, 'utf8');

console.log(`Wrote ${out}`);
console.log(`  plugin   ${name}@${version}`);
console.log(`  source   git ${homepage} @ ${commit}`);
console.log(`  install  git+${homepage}.git#${commit}`);
const pagesOrigin = repository.split('/')[0];
console.log(`  index    https://${pagesOrigin}.github.io/${repository.split('/')[1]}/index.json`);
