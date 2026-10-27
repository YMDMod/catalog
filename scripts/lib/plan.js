'use strict';
const crypto = require('crypto');

const TOPIC = 'ymdmod-addon';
const SUPPORTED_API_VERSIONS = [1];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const FILE_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const MAX_ADDON_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_NEW_PER_RUN = 5;
const NOT_PUBLISHED = [/(^|\/)\./, /^(test|tests|docs)\//, /\.md$/i];
const MARKER = /<!-- ymdmod-bot (\{.*?\}) -->/;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const versionFromTag = (tag) => String(tag).replace(/^v/, '');

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

const branchFor = (repo) => `bot/${repo.replace('/', '--')}`;

function readMarker(body) {
  const match = MARKER.exec(body || '');
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

const writeMarker = (data) => `<!-- ymdmod-bot ${JSON.stringify(data)} -->`;

function catalogText(catalog) {
  const addons = [...catalog.addons].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ ...catalog, addons }, null, 2)}\n`;
}

function publishedFiles(tree, manifest) {
  const paths = tree.map((f) => f.path);
  if (Array.isArray(manifest.files)) return [...new Set(['manifest.json', ...manifest.files])].filter((p) => paths.includes(p));
  return paths.filter((p) => !NOT_PUBLISHED.some((pattern) => pattern.test(p)));
}

function validate(manifest, files, version) {
  const errors = [];
  if (!ID_PATTERN.test(manifest.id || '')) errors.push('id: только a-z, 0-9 и дефис');
  if (typeof manifest.name !== 'string' || !manifest.name) errors.push('нет name');
  if (manifest.version !== version) errors.push(`версия в manifest.json (${manifest.version}) не совпадает с тегом релиза (${version})`);
  if (!SUPPORTED_API_VERSIONS.includes(manifest.apiVersion)) errors.push(`apiVersion ${manifest.apiVersion} не поддерживается`);
  if (manifest.modVersions !== undefined && !Array.isArray(manifest.modVersions)) errors.push('modVersions должен быть списком');
  if (manifest.type !== undefined && !['addon', 'library'].includes(manifest.type)) errors.push('type: только addon или library');
  const deps = manifest.dependencies;
  if (deps !== undefined && (!deps || typeof deps !== 'object' || Array.isArray(deps)
    || Object.entries(deps).some(([id, range]) => !ID_PATTERN.test(id) || id === manifest.id || typeof range !== 'string' || !range.trim()))) {
    errors.push('dependencies должен быть объектом { "id": "версии" } без ссылки на себя');
  }
  for (const key of ['main', 'renderer']) {
    if (manifest[key] && !files.some((f) => f.path === manifest[key])) errors.push(`${key}: файла ${manifest[key]} нет в релизе`);
  }
  if (!manifest.main && !manifest.renderer) errors.push('нет ни main, ни renderer');
  if (files.length > MAX_FILES) errors.push(`больше ${MAX_FILES} файлов`);
  const bad = files.find((f) => !FILE_PATTERN.test(f.path));
  if (bad) errors.push(`недопустимый путь файла: ${bad.path}`);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ADDON_BYTES) errors.push(`больше ${MAX_ADDON_BYTES} байт`);
  return errors;
}

async function inspectRelease(client, repo, release) {
  const version = versionFromTag(release.tag);
  if (!VERSION_PATTERN.test(version)) return { errors: [`тег ${release.tag} не похож на vX.Y.Z`] };
  const commit = await client.commitOf(repo, release.tag);
  const tree = await client.tree(repo, commit);
  if (!tree.some((f) => f.path === 'manifest.json')) return { errors: ['в корне нет manifest.json'] };

  let manifest;
  try {
    manifest = JSON.parse((await client.file(repo, commit, 'manifest.json')).toString('utf8'));
  } catch {
    return { errors: ['manifest.json не читается как JSON'] };
  }
  const sizes = new Map(tree.map((f) => [f.path, f.size]));
  const paths = publishedFiles(tree, manifest);
  const precheck = validate(manifest, paths.map((p) => ({ path: p, size: sizes.get(p) })), version);
  if (precheck.length) return { errors: precheck };

  const files = [];
  for (const path of paths) {
    const data = await client.file(repo, commit, path);
    files.push({ path, size: data.length, sha256: sha256(data) });
  }
  const entry = {
    id: manifest.id,
    name: manifest.name,
    version,
    description: manifest.description || '',
    author: manifest.author || repo.split('/')[0],
    repo,
    tag: release.tag,
    commit,
    apiVersion: manifest.apiVersion,
    modVersions: manifest.modVersions || [],
    type: manifest.type || 'addon',
    dependencies: manifest.dependencies || {},
    files,
  };
  return { entry, notes: release.body || '', url: release.url };
}

function dependencyLines(entry, catalog) {
  const deps = Object.entries(entry.dependencies);
  if (!deps.length) return [];
  return ['', '### Зависимости', '', ...deps.map(([id, range]) => {
    const found = catalog.addons.find((e) => e.id === id);
    return `- \`${id}\` ${range} — ${found ? `в каталоге ${found.version}` : '**нет в каталоге: у пользователей аддон не поставится**'}`;
  })];
}

function pullBody({ kind, repo, entry, previous, notes, url, marker, catalog }) {
  const lines = [];
  if (entry.type === 'library') lines.push('Тип: библиотека.', '');
  if (kind === 'new') {
    lines.push(`Новый аддон **${entry.name}** (\`${entry.id}\`) ${entry.version} из [${repo}](https://github.com/${repo}).`);
    lines.push('', `Код релиза: https://github.com/${repo}/tree/${entry.commit}`);
  } else {
    lines.push(`Обновление **${entry.name}** (\`${entry.id}\`): ${previous.version} → ${entry.version}.`);
    lines.push('', `Что изменилось в коде: https://github.com/${repo}/compare/${previous.commit}...${entry.commit}`);
  }
  if (url) lines.push(`Релиз: ${url}`);
  if (notes.trim()) lines.push('', '### Описание релиза от автора', '', ...notes.trim().split('\n').map((line) => `> ${line}`));
  lines.push(...dependencyLines(entry, catalog));
  lines.push('', '### Файлы', '', ...entry.files.map((f) => `- \`${f.path}\` — ${f.size} байт`));
  lines.push('', 'Merge — версия попадёт к пользователям. Close — не попадёт: новый аддон больше не будет предлагаться, отклонённая версия тоже.');
  lines.push('', writeMarker(marker));
  return lines.join('\n');
}

async function plan(client, catalog, mainText) {
  const log = [];
  const actions = [];
  const base = sha256(mainText);
  const blocked = new Set(catalog.blocked || []);
  const approved = new Map(catalog.addons.map((entry) => [entry.repo, entry]));

  const pulls = (await client.botPulls()).map((p) => ({ ...p, marker: readMarker(p.body) })).filter((p) => p.marker);
  const openPull = new Map(pulls.filter((p) => p.state === 'open').map((p) => [p.marker.repo, p]));
  const rejected = pulls.filter((p) => p.state === 'closed' && !p.merged && !p.marker.obsolete).map((p) => p.marker);
  const isRejected = (repo, kind, version) => rejected.some((m) => m.repo === repo && m.kind === kind && (kind === 'new' || m.version === version));

  const idOwner = new Map(catalog.addons.map((entry) => [entry.id, entry.repo]));
  for (const pull of openPull.values()) if (pull.marker.id && !idOwner.has(pull.marker.id)) idOwner.set(pull.marker.id, pull.marker.repo);

  const found = (await client.searchTopic(TOPIC)).filter((r) => !r.fork && !r.archived).map((r) => r.repo);
  const repos = [...new Set([...approved.keys(), ...found])].sort();
  let newCount = 0;

  const close = (pull, reason) => {
    actions.push({ type: 'close', pull, body: `${pull.body.replace(MARKER, '')}\n\n${reason}\n\n${writeMarker({ ...pull.marker, obsolete: true })}` });
  };

  for (const repo of repos) {
    const pull = openPull.get(repo);
    if (blocked.has(repo)) {
      if (pull) close(pull, 'Репозиторий в blocked.');
      continue;
    }
    const release = await client.latestRelease(repo);
    if (!release) {
      log.push(`${repo}: нет релизов`);
      continue;
    }
    const version = versionFromTag(release.tag);
    const previous = approved.get(repo);
    const kind = previous ? 'update' : 'new';

    if (previous && VERSION_PATTERN.test(version) && compareVersions(version, previous.version) <= 0) {
      if (pull) close(pull, `В каталоге уже ${previous.version}.`);
      continue;
    }
    if (isRejected(repo, kind, version)) {
      log.push(`${repo} ${version}: отклонено владельцем, не предлагаю снова`);
      continue;
    }
    if (pull && pull.marker.version === version && pull.marker.base === base) continue;
    if (kind === 'new' && !pull && newCount >= MAX_NEW_PER_RUN) {
      log.push(`${repo}: отложено, за один запуск не больше ${MAX_NEW_PER_RUN} новых аддонов`);
      continue;
    }

    let inspected;
    try {
      inspected = await inspectRelease(client, repo, release);
    } catch (error) {
      log.push(`${repo} ${release.tag}: ошибка GitHub — ${error.message}`);
      continue;
    }
    if (inspected.errors) {
      log.push(`${repo} ${release.tag}: не подходит — ${inspected.errors.join('; ')}`);
      continue;
    }
    const { entry } = inspected;
    const owner = idOwner.get(entry.id);
    if (owner && owner !== repo) {
      log.push(`${repo}: id "${entry.id}" уже занят ${owner}`);
      if (pull) close(pull, `id "${entry.id}" уже занят ${owner}.`);
      continue;
    }
    idOwner.set(entry.id, repo);

    if (kind === 'new' && !pull) newCount += 1;
    const next = { ...catalog, addons: [...catalog.addons.filter((e) => e.repo !== repo), entry] };
    const marker = { kind, repo, id: entry.id, version, base };
    actions.push({
      type: pull ? 'update' : 'open',
      pull,
      branch: branchFor(repo),
      title: kind === 'new' ? `Новый аддон: ${entry.name} ${version} (${repo})` : `${entry.name}: ${previous.version} → ${version}`,
      body: pullBody({ kind, repo, entry, previous, notes: inspected.notes, url: inspected.url, marker, catalog }),
      catalogText: catalogText(next),
    });
  }

  for (const [repo, pull] of openPull) {
    if (!repos.includes(repo)) close(pull, 'Репозиторий больше не найден по топику.');
  }
  return { actions, log };
}

module.exports = { plan, catalogText, readMarker, branchFor, TOPIC };
