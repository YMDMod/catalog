'use strict';
const fs = require('fs');
const path = require('path');

function createFakeClient(dir) {
  const read = (name, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return fallback;
    }
  };
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  const repoInfo = (repo) => read('repos.json', {})[repo];
  const commitDir = (repo, commit) => path.join(dir, 'raw', ...repo.split('/'), commit);

  function walk(root, prefix = '') {
    const result = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...walk(path.join(root, entry.name), rel));
      else result.push({ path: rel, size: fs.statSync(path.join(root, entry.name)).size });
    }
    return result;
  }

  return {
    async searchTopic(topic) {
      return Object.entries(read('repos.json', {}))
        .filter(([, info]) => (info.topics || []).includes(topic))
        .map(([repo, info]) => ({ repo, fork: Boolean(info.fork), archived: Boolean(info.archived) }));
    },
    async latestRelease(repo) {
      const releases = ((repoInfo(repo) || {}).releases || []).filter((r) => !r.draft && !r.prerelease);
      const last = releases[releases.length - 1];
      return last && { tag: last.tag, body: last.body || '', url: `https://github.com/${repo}/releases/tag/${last.tag}` };
    },
    async commitOf(repo, tag) {
      const release = ((repoInfo(repo) || {}).releases || []).find((r) => r.tag === tag);
      if (!release) throw new Error(`тег ${tag} не найден`);
      return release.commit;
    },
    async tree(repo, commit) {
      return walk(commitDir(repo, commit));
    },
    async file(repo, commit, file) {
      return fs.readFileSync(path.join(commitDir(repo, commit), ...file.split('/')));
    },
    async botPulls() {
      return read('pulls.json', []);
    },
    async pushCatalog(branch, text) {
      write('branches.json', { ...read('branches.json', {}), [branch]: text });
    },
    async createPull(branch, title, body) {
      const pulls = read('pulls.json', []);
      const number = pulls.reduce((max, p) => Math.max(max, p.number), 0) + 1;
      write('pulls.json', [...pulls, { number, state: 'open', merged: false, branch, title, body }]);
      return { number };
    },
    async updatePull(number, title, body) {
      write('pulls.json', read('pulls.json', []).map((p) => (p.number === number ? { ...p, title, body } : p)));
    },
    async closePull(number, body) {
      write('pulls.json', read('pulls.json', []).map((p) => (p.number === number ? { ...p, state: 'closed', body } : p)));
    },
  };
}

module.exports = { createFakeClient };
