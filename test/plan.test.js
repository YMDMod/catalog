'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { plan, readMarker } = require('../scripts/lib/plan');
const { createFakeClient } = require('./fake-github');

const EMPTY = { schema: 2, addons: [], blocked: [] };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ymd-catalog-'));
  const client = createFakeClient(dir);
  const json = (name, fallback) => (fs.existsSync(path.join(dir, name)) ? JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) : fallback);
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  let catalog = EMPTY;

  const release = (repo, version, { files, manifest = {}, topic = true, fork = false, draft = false } = {}) => {
    const commit = crypto.createHash('sha1').update(`${repo}${version}${Math.random()}`).digest('hex');
    const root = path.join(dir, 'raw', ...repo.split('/'), commit);
    const id = repo.split('/')[1];
    const all = {
      'manifest.json': JSON.stringify({ id, name: id, version, ...manifest }),
      'renderer.js': `module.exports = { start() {} }; // ${version}`,
      ...files,
    };
    for (const [rel, text] of Object.entries(all)) {
      if (text === null) continue;
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const repos = json('repos.json', {});
    const info = repos[repo] || { topics: topic ? ['ymdmod-addon'] : [], fork, releases: [] };
    info.releases.push({ tag: `v${version}`, commit, body: `notes ${version}`, draft, prerelease: false });
    save('repos.json', { ...repos, [repo]: info });
    return commit;
  };

  const run = async () => {
    const text = JSON.stringify(catalog);
    const result = await plan(client, catalog, text);
    for (const action of result.actions) {
      if (action.type === 'close') await client.closePull(action.pull.number, action.body);
      else {
        await client.pushCatalog(action.branch, action.catalogText);
        if (action.type === 'open') await client.createPull(action.branch, action.title, action.body);
        else await client.updatePull(action.pull.number, action.title, action.body);
      }
    }
    return result;
  };
  const pulls = () => json('pulls.json', []);
  const merge = (number) => {
    const pull = pulls().find((p) => p.number === number);
    catalog = JSON.parse(json('branches.json', {})[pull.branch]);
    save('pulls.json', pulls().map((p) => (p.number === number ? { ...p, state: 'closed', merged: true } : p)));
  };
  const close = (number) => save('pulls.json', pulls().map((p) => (p.number === number ? { ...p, state: 'closed' } : p)));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { release, run, pulls, merge, close, cleanup, catalog: () => catalog, setCatalog: (c) => { catalog = c; } };
}

test('новый аддон: пулл-реквест с записью каталога, файлами и sha256', async () => {
  const gh = setup();
  try {
    const commit = gh.release('vasya/lyrics', '1.0.0', { files: { 'README.md': '# x', '.github/ci.yml': 'x', 'test/a.js': 'x' } });
    await gh.run();
    const [pull] = gh.pulls();
    assert.equal(pull.title, 'Новый аддон: lyrics 1.0.0 (vasya/lyrics)');
    assert.deepEqual(readMarker(pull.body).kind, 'new');
    assert.match(pull.body, new RegExp(`tree/${commit}`));
    gh.merge(pull.number);
    const [entry] = gh.catalog().addons;
    assert.equal(entry.commit, commit);
    assert.deepEqual(entry.files.map((f) => f.path), ['manifest.json', 'renderer.js'], 'README, .github и test не публикуются');
    assert.equal(entry.files[1].sha256, crypto.createHash('sha256').update('module.exports = { start() {} }; // 1.0.0').digest('hex'));
    await gh.run();
    assert.equal(gh.pulls().filter((p) => p.state === 'open').length, 0, 'после merge нечего предлагать');
  } finally {
    gh.cleanup();
  }
});

test('обновление: ссылка на сравнение коммитов, отклонённая версия не предлагается снова', async () => {
  const gh = setup();
  try {
    const v1 = gh.release('vasya/lyrics', '1.0.0');
    await gh.run();
    gh.merge(1);
    const v2 = gh.release('vasya/lyrics', '1.1.0');
    await gh.run();
    const update = gh.pulls().find((p) => p.state === 'open');
    assert.equal(update.title, 'lyrics: 1.0.0 → 1.1.0');
    assert.match(update.body, new RegExp(`compare/${v1}\\.\\.\\.${v2}`));
    assert.match(update.body, /> notes 1\.1\.0/);
    gh.close(update.number);
    await gh.run();
    assert.equal(gh.pulls().filter((p) => p.state === 'open').length, 0);
    gh.release('vasya/lyrics', '1.2.0');
    await gh.run();
    assert.equal(gh.pulls().find((p) => p.state === 'open').title, 'lyrics: 1.0.0 → 1.2.0');
  } finally {
    gh.cleanup();
  }
});

test('отклонённый новый аддон больше не предлагается, даже с новым релизом', async () => {
  const gh = setup();
  try {
    gh.release('spam/junk', '1.0.0');
    await gh.run();
    gh.close(1);
    gh.release('spam/junk', '2.0.0');
    const { log } = await gh.run();
    assert.equal(gh.pulls().length, 1);
    assert.ok(log.some((line) => line.includes('отклонено владельцем')));
  } finally {
    gh.cleanup();
  }
});

test('новая версия, пока пулл-реквест открыт, обновляет тот же пулл-реквест', async () => {
  const gh = setup();
  try {
    gh.release('vasya/lyrics', '1.0.0');
    await gh.run();
    gh.release('vasya/lyrics', '1.0.1');
    await gh.run();
    assert.equal(gh.pulls().length, 1);
    assert.match(gh.pulls()[0].title, /1\.0\.1/);
  } finally {
    gh.cleanup();
  }
});

test('после merge одного предложения открытые пересобираются поверх нового каталога', async () => {
  const gh = setup();
  try {
    gh.release('a/one', '1.0.0');
    gh.release('b/two', '1.0.0');
    await gh.run();
    gh.merge(1);
    await gh.run();
    gh.merge(2);
    assert.deepEqual(gh.catalog().addons.map((e) => e.id), ['one', 'two'], 'второй merge не затёр первый');
  } finally {
    gh.cleanup();
  }
});

test('не предлагаются: форки, черновики, кривые релизы, занятый id, blocked', async () => {
  const gh = setup();
  try {
    gh.release('x/forked', '1.0.0', { fork: true });
    gh.release('x/draft', '1.0.0', { draft: true });
    gh.release('x/nomanifest', '1.0.0', { files: { 'manifest.json': null } });
    gh.release('x/badversion', '1.0.0', { manifest: { version: '0.9.0' } });
    gh.release('x/noentry', '1.0.0', { files: { 'renderer.js': null } });
    gh.release('x/blockedrepo', '1.0.0');
    gh.release('a/lyrics', '1.0.0');
    gh.release('b/lyrics', '1.0.0');
    gh.setCatalog({ ...EMPTY, blocked: ['x/blockedrepo'] });
    await gh.run();
    gh.merge(1);
    const { log } = await gh.run();
    assert.deepEqual(gh.pulls().map((p) => p.title), ['Новый аддон: lyrics 1.0.0 (a/lyrics)']);
    const text = log.join('\n');
    assert.match(text, /x\/nomanifest.*нет manifest\.json/);
    assert.match(text, /x\/badversion.*не совпадает с тегом/);
    assert.match(text, /x\/noentry.*нет ни main\.js, ни renderer\.js/);
    assert.match(text, /b\/lyrics: id "lyrics" уже занят a\/lyrics/);
  } finally {
    gh.cleanup();
  }
});

test('зависимости переносятся в каталог, автор берётся из владельца репозитория, кривые зависимости отсеиваются', async () => {
  const gh = setup();
  try {
    gh.release('a/lib', '1.0.0', { manifest: { author: 'Кто-то другой' } });
    gh.release('b/player', '1.0.0', { manifest: { dependencies: { lib: '>=1.0.0', ghost: '*' } } });
    gh.release('c/broken', '1.0.0', { manifest: { dependencies: ['lib'] } });
    const { log } = await gh.run();
    const player = gh.pulls().find((p) => p.title.includes('b/player'));
    assert.match(player.body, /`lib` >=1\.0\.0 — \*\*нет в каталоге/);
    assert.match(player.body, /`ghost` \* — \*\*нет в каталоге/);
    gh.merge(gh.pulls().find((p) => p.title.includes('a/lib')).number);
    await gh.run();
    assert.match(gh.pulls().find((p) => p.number === player.number).body, /`lib` >=1\.0\.0 — в каталоге 1\.0\.0/);
    gh.merge(player.number);
    const [lib, playerEntry] = gh.catalog().addons;
    assert.equal(lib.author, 'a');
    assert.equal(lib.type, undefined);
    assert.equal(lib.apiVersion, undefined);
    assert.deepEqual(playerEntry.dependencies, { lib: '>=1.0.0', ghost: '*' });
    assert.match(log.join('\n'), /c\/broken.*dependencies должен быть объектом/);
  } finally {
    gh.cleanup();
  }
});

test('за один запуск не больше 5 новых аддонов', async () => {
  const gh = setup();
  try {
    for (let i = 1; i <= 7; i++) gh.release(`spam/a${i}`, '1.0.0');
    await gh.run();
    assert.equal(gh.pulls().length, 5);
    await gh.run();
    assert.equal(gh.pulls().length, 7);
  } finally {
    gh.cleanup();
  }
});
