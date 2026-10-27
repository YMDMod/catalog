'use strict';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

function createClient({ token, self, mainBranch = 'main' }) {
  async function request(method, path, body, accept = 'application/vnd.github+json') {
    const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ymdmod-catalog-bot',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
    if (response.status === 204) return null;
    return accept.endsWith('.sha') ? response.text() : response.json();
  }

  async function pages(path, pick, limit = 10) {
    const result = [];
    for (let page = 1; page <= limit; page++) {
      const data = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = pick(data || []);
      result.push(...items);
      if (items.length < 100) break;
    }
    return result;
  }

  return {
    async searchTopic(topic) {
      const items = await pages(`/search/repositories?q=${encodeURIComponent(`topic:${topic}`)}`, (data) => data.items || []);
      return items.map((r) => ({ repo: r.full_name, fork: r.fork, archived: r.archived }));
    },

    async latestRelease(repo) {
      const release = await request('GET', `/repos/${repo}/releases/latest`);
      return release && { tag: release.tag_name, body: release.body || '', url: release.html_url };
    },

    async commitOf(repo, tag) {
      const sha = await request('GET', `/repos/${repo}/commits/${encodeURIComponent(tag)}`, null, 'application/vnd.github.sha');
      if (!sha) throw new Error(`тег ${tag} не найден`);
      return sha.trim();
    },

    async tree(repo, commit) {
      const data = await request('GET', `/repos/${repo}/git/trees/${commit}?recursive=1`);
      if (!data) throw new Error(`коммит ${commit} не найден`);
      if (data.truncated) throw new Error('слишком много файлов в репозитории');
      return data.tree.filter((item) => item.type === 'blob').map((item) => ({ path: item.path, size: item.size }));
    },

    async file(repo, commit, path) {
      const response = await fetch(`${RAW}/${repo}/${commit}/${path}`);
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },

    async botPulls() {
      const pulls = await pages(`/repos/${self}/pulls?state=all`, (data) => data);
      return pulls
        .filter((p) => p.head.ref.startsWith('bot/'))
        .map((p) => ({ number: p.number, state: p.state, merged: Boolean(p.merged_at), branch: p.head.ref, body: p.body || '' }));
    },

    async pushCatalog(branch, text, message) {
      const main = await request('GET', `/repos/${self}/git/ref/heads/${mainBranch}`);
      const moved = await request('PATCH', `/repos/${self}/git/refs/heads/${branch}`, { sha: main.object.sha, force: true }).catch(() => null);
      if (!moved) await request('POST', `/repos/${self}/git/refs`, { ref: `refs/heads/${branch}`, sha: main.object.sha });
      const current = await request('GET', `/repos/${self}/contents/catalog.json?ref=${encodeURIComponent(branch)}`);
      await request('PUT', `/repos/${self}/contents/catalog.json`, {
        message,
        content: Buffer.from(text, 'utf8').toString('base64'),
        branch,
        sha: current ? current.sha : undefined,
      });
    },

    createPull(branch, title, body) {
      return request('POST', `/repos/${self}/pulls`, { title, head: branch, base: mainBranch, body });
    },

    updatePull(number, title, body) {
      return request('PATCH', `/repos/${self}/pulls/${number}`, { title, body });
    },

    closePull(number, body) {
      return request('PATCH', `/repos/${self}/pulls/${number}`, { state: 'closed', body });
    },
  };
}

module.exports = { createClient };
