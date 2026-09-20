#!/usr/bin/env node
// Rebuilds a PR index from squash-merge commits in local clones. GitHub is gone; git is not.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORK_DIR = process.argv[2];
if (!WORK_DIR) {
  console.error("usage: node extract.js <directory containing your clones>");
  process.exit(1);
}
const OUT = path.join(__dirname, 'prs.json');
const US = '\x1f';
const RS = '\x1e';

const AI_AUTHORS = /anthropic\.com|cursoragent|cursor\.com|copilot|devin|openai\.com/i;
const STRIP_TRAILERS = /^(co-authored-by|signed-off-by|reviewed-by|tested-by|helped-by|acked-by|on-behalf-of):/i;

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
}

function tryGit(repo, args) {
  try { return git(repo, args); } catch { return null; }
}

function findRepos(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(root, d.name, '.git')))
    .map(d => ({ name: d.name, dir: path.join(root, d.name) }));
}

function defaultBranch(repo) {
  const head = tryGit(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head) return head.trim().replace('refs/remotes/origin/', '');
  for (const b of ['main', 'master', 'develop', 'dev']) {
    if (tryGit(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + b])) return b;
  }
  return null;
}

// Splits a squashed body into prose, the sub-commit list, and co-author credits.
function parseBody(raw) {
  const coauthors = [];
  const keep = [];
  for (const line of (raw || '').split('\n')) {
    if (STRIP_TRAILERS.test(line.trim())) {
      const m = line.match(/:\s*(.+)$/);
      if (m && /co-authored-by/i.test(line)) coauthors.push(m[1].trim());
      continue;
    }
    keep.push(line);
  }
  let text = keep.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^[\s-]*\n/, '').trim();
  text = text.replace(/\n-{5,}\s*$/, '').trim();

  const commits = [];
  let description = text;
  if (/^\*\s+/.test(text)) {
    description = '';
    const chunks = text.split(/\n(?=\*\s+)/);
    for (const chunk of chunks) {
      const body = chunk.replace(/^\*\s+/, '');
      const nl = body.indexOf('\n');
      const subject = (nl === -1 ? body : body.slice(0, nl)).trim();
      const rest = (nl === -1 ? '' : body.slice(nl + 1)).replace(/-{5,}/g, '').trim();
      if (subject) commits.push({ subject, body: rest });
    }
    // When the squash kept only per-commit prose, promote the richest chunk to the description.
    const richest = commits.filter(c => c.body).sort((a, b) => b.body.length - a.body.length)[0];
    if (richest && commits.length === 1) { description = richest.body; commits.length = 0; }
  }

  const uniq = [...new Set(coauthors)];
  return {
    description,
    commits,
    coauthors: uniq.filter(c => !AI_AUTHORS.test(c)),
    assistants: uniq.filter(c => AI_AUTHORS.test(c)).map(c => c.replace(/\s*<[^>]*>/, '')),
  };
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!?):\s*(.+)$/;

function readRepo(repo) {
  const { name, dir } = repo;
  const branch = defaultBranch(dir);
  const onMain = new Set();
  if (branch) {
    const revs = tryGit(dir, ['rev-list', branch]);
    if (revs) revs.split('\n').forEach(s => s && onMain.add(s.trim()));
  }

  const fmt = `${RS}%H${US}%an${US}%ae${US}%aI${US}%s${US}%b${US}`;
  const raw = git(dir, ['log', '--all', '--numstat', '--no-color', `--format=${fmt}`]);
  const byNumber = new Map();

  for (const chunk of raw.split(RS)) {
    if (!chunk.trim()) continue;
    const parts = chunk.split(US);
    if (parts.length < 6) continue;
    const [sha, author, email, date, subject, body] = parts;
    const tail = parts.slice(6).join(US);

    let number = null, title = null, sourceBranch = null;
    let m = subject.match(/^(.*)\s+\(#(\d+)\)\s*$/);
    if (m) { title = m[1].trim(); number = +m[2]; }
    else {
      m = subject.match(/^Merge pull request #(\d+) from (\S+)/);
      if (!m) continue;
      number = +m[1];
      sourceBranch = m[2];
      title = (body || '').split('\n').find(l => l.trim()) || subject;
      title = title.trim();
    }

    let added = 0, removed = 0, binary = 0;
    const files = [];
    for (const line of tail.split('\n')) {
      const f = line.split('\t');
      if (f.length !== 3 || !f[2]) continue;
      if (f[0] === '-') { binary++; files.push({ path: f[2], added: 0, removed: 0, binary: true }); continue; }
      const a = +f[0] || 0, r = +f[1] || 0;
      added += a; removed += r;
      files.push({ path: f[2], added: a, removed: r, binary: false });
    }

    const conv = title.match(CONVENTIONAL);
    const parsed = parseBody(body);
    const pr = {
      repo: name,
      number,
      sha: sha.trim(),
      title: conv ? conv[4] : title,
      fullTitle: title,
      type: conv ? conv[1].toLowerCase() : null,
      scope: conv && conv[2] ? conv[2] : null,
      breaking: !!(conv && conv[3]),
      author: author.trim(),
      email: email.trim(),
      date: date.trim(),
      year: date.slice(0, 4),
      onMain: onMain.has(sha.trim()),
      sourceBranch,
      description: parsed.description,
      commits: parsed.commits,
      coauthors: parsed.coauthors,
      assistants: parsed.assistants,
      refs: [...new Set((body + ' ' + title).match(/#\d+/g) || [])]
        .map(r => +r.slice(1)).filter(r => r !== number),
      filesChanged: files.length,
      added,
      removed,
      binary,
      files: files.slice(0, 300),
    };

    // A cherry-picked or rebased duplicate loses to the copy that actually landed on the default branch.
    const prev = byNumber.get(number);
    if (!prev || (pr.onMain && !prev.onMain) || (pr.onMain === prev.onMain && pr.date > prev.date)) {
      byNumber.set(number, pr);
    }
  }
  return [...byNumber.values()];
}

const repos = findRepos(WORK_DIR);
const all = [];
const summary = [];
for (const repo of repos) {
  process.stdout.write(`  ${repo.name} ... `);
  try {
    const prs = readRepo(repo);
    all.push(...prs);
    summary.push({ repo: repo.name, prs: prs.length });
    console.log(`${prs.length} PRs`);
  } catch (e) {
    console.log(`skipped (${e.message.split('\n')[0]})`);
  }
}

all.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  workDir: WORK_DIR,
  repos: summary,
  prs: all,
}));

const withDesc = all.filter(p => (p.description && p.description.length > 20) || p.commits.some(c => c.body && c.body.length > 20)).length;
console.log(`\n${all.length} PRs -> prs.json (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
console.log(`${withDesc} with a description (${Math.round(withDesc / all.length * 100)}%)`);
