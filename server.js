#!/usr/bin/env node
// Serves the PR index; diffs are read from the clones on demand so nothing is duplicated on disk.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = +process.env.PORT || 4000;
const DATA = path.join(__dirname, 'prs.json');
const PUBLIC = path.join(__dirname, 'public');
const MAX_PATCH = 1_500_000;

if (!fs.existsSync(DATA)) {
  console.error('prs.json missing - run: node extract.js <directory containing your clones>');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const PRS = db.prs;
const REPOS = new Set(PRS.map(p => p.repo));
const hasProse = p => (p.description && p.description.length > 20) || p.commits.some(c => c.body && c.body.length > 20);
for (const p of PRS) {
  p._prose = hasProse(p);
  p._haystack = (p.fullTitle + ' ' + p.description + ' ' + p.commits.map(c => c.subject + ' ' + c.body).join(' ') + ' ' + p.author).toLowerCase();
}

const META = {
  generatedAt: db.generatedAt,
  total: PRS.length,
  withProse: PRS.filter(p => p._prose).length,
  repos: tally('repo'),
  authors: tally('author').slice(0, 60),
  types: tally('type'),
  scopes: tally('scope').slice(0, 40),
  years: tally('year'),
};

function tally(key) {
  const m = new Map();
  for (const p of PRS) { const v = p[key]; if (v) m.set(v, (m.get(v) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

function list(q) {
  const term = (q.q || '').trim().toLowerCase();
  const words = term ? term.split(/\s+/) : [];
  const out = PRS.filter(p => {
    if (q.repo && p.repo !== q.repo) return false;
    if (q.author && p.author !== q.author) return false;
    if (q.type && p.type !== q.type) return false;
    if (q.scope && p.scope !== q.scope) return false;
    if (q.year && p.year !== q.year) return false;
    if (q.prose === '1' && !p._prose) return false;
    if (words.length && !words.every(w => p._haystack.includes(w))) return false;
    return true;
  });
  if (q.sort === 'oldest') out.reverse();
  else if (q.sort === 'largest') out.sort((a, b) => (b.added + b.removed) - (a.added + a.removed));
  return out;
}

const SLIM = p => ({
  repo: p.repo, number: p.number, title: p.title, type: p.type, scope: p.scope,
  author: p.author, date: p.date, added: p.added, removed: p.removed,
  filesChanged: p.filesChanged, prose: p._prose, commits: p.commits.length,
});

function diff(repo, sha, cb) {
  if (!REPOS.has(repo) || !/^[0-9a-f]{7,40}$/.test(sha)) return cb(new Error('bad ref'));
  const cwd = path.join(db.workDir, repo);
  execFile('git', ['show', '--format=', '--patch', '-M', '--no-color', sha],
    { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    (err, stdout) => {
      if (err) return cb(err);
      cb(null, stdout.length > MAX_PATCH
        ? { patch: stdout.slice(0, MAX_PATCH), truncated: true }
        : { patch: stdout, truncated: false });
    });
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/api/meta') return json(200, META);

  if (url.pathname === '/api/prs') {
    const all = list(q);
    const page = Math.max(1, +q.page || 1);
    const size = Math.min(100, +q.size || 40);
    return json(200, {
      total: all.length,
      page,
      pages: Math.max(1, Math.ceil(all.length / size)),
      order: all.map(p => `${p.repo}/${p.number}`),
      prs: all.slice((page - 1) * size, page * size).map(SLIM),
    });
  }

  const m = url.pathname.match(/^\/api\/pr\/([\w.-]+)\/(\d+)$/);
  if (m) {
    const pr = PRS.find(p => p.repo === m[1] && p.number === +m[2]);
    if (!pr) return json(404, { error: 'not found' });
    return diff(pr.repo, pr.sha, (err, d) => {
      const { _haystack, _prose, ...rest } = pr;
      json(200, { ...rest, prose: _prose, diff: err ? null : d.patch, truncated: !err && d.truncated, diffError: err ? err.message.split('\n')[0] : null });
    });
  }

  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'text/plain', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => {
  console.log(`\n  PR archive`);
  console.log(`  ${META.total} PRs from ${META.repos.length} repos, ${META.withProse} with descriptions`);
  console.log(`\n  http://localhost:${PORT}\n`);
});
