'use strict';

const app = document.getElementById('app');
const qBox = document.getElementById('q');
const KNOWN_TYPES = ['feat', 'fix', 'refactor', 'perf'];
const FACET_KEYS = ['repo', 'type', 'year', 'author', 'scope', 'prose', 'sort'];

let META = null;
let ORDER = [];              // every PR key matching the current filter, for prev/next across pages
let listQS = sessionStorage.getItem('fpr-qs') || '';
let selected = -1;
const READ = new Set(JSON.parse(localStorage.getItem('fpr-read') || '[]'));

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const key = p => p.repo + '/' + p.number;
const tagClass = t => (KNOWN_TYPES.includes(t) ? 't-' + t : 't-other');

function saveRead() { localStorage.setItem('fpr-read', JSON.stringify([...READ])); }

function ago(iso) {
  const d = new Date(iso), days = Math.floor((Date.now() - d) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  if (days < 365) return Math.floor(days / 30) + ' months ago';
  return d.toISOString().slice(0, 10);
}

/* ---------- routing ---------- */

function route() {
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?');
  const m = path.match(/^\/pr\/([\w.-]+)\/(\d+)$/);
  if (m) return { view: 'pr', repo: m[1], number: +m[2] };
  return { view: 'list', params: new URLSearchParams(qs || '') };
}

function go(params) {
  const qs = params.toString();
  listQS = qs;
  sessionStorage.setItem('fpr-qs', qs);
  location.hash = '#/' + (qs ? '?' + qs : '');
}

function setParam(k, v) {
  const p = new URLSearchParams(listQS);
  if (v == null || v === '' || p.get(k) === v) p.delete(k); else p.set(k, v);
  if (k !== 'page') p.delete('page');
  go(p);
}

/* ---------- markdown-lite ---------- */

function md(src, repo) {
  if (!src || !src.trim()) return '';
  const fences = [];
  let s = esc(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    fences.push(code.replace(/\n$/, ''));
    return '\u0000' + (fences.length - 1) + '\u0000';
  });

  const inline = t => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(\[])#(\d+)\b/g, (_, pre, n) => pre + '<a href="#/pr/' + repo + '/' + n + '">#' + n + '</a>');

  let out = '', para = [], list = null;
  const flushPara = () => { if (para.length) { out += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
  const flushList = () => {
    if (list) { out += '<' + list.tag + '>' + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + '</' + list.tag + '>'; list = null; }
  };

  for (const raw of s.split('\n')) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const fence = line.match(/^\u0000(\d+)\u0000$/);
    if (fence) { flushPara(); flushList(); out += '<pre><code>' + fences[+fence[1]] + '</code></pre>'; continue; }
    let m = line.match(/^[-*+]\s+(.*)$/);
    if (m) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    m = line.match(/^\d+[.)]\s+(.*)$/);
    if (m) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out;
}

/* ---------- list view ---------- */

function facetLinks(title, key, items, current) {
  if (!items.length) return '';
  return '<div class="facet"><h3>' + title + '</h3>' +
    items.map(i => '<a href="#" data-facet="' + key + '" data-value="' + esc(i.value) + '"' +
      (current === i.value ? ' class="on"' : '') + '><span>' + esc(i.value) + '</span><span class="n">' + i.count + '</span></a>').join('') +
    '</div>';
}

function facetSelect(title, key, items, current) {
  if (!items.length) return '';
  return '<div class="facet"><h3>' + title + '</h3><select data-select="' + key + '">' +
    '<option value="">All</option>' +
    items.map(i => '<option value="' + esc(i.value) + '"' + (current === i.value ? ' selected' : '') + '>' +
      esc(i.value) + ' (' + i.count + ')</option>').join('') + '</select></div>';
}

function prRow(p, i) {
  const cls = 'pr' + (READ.has(key(p)) ? ' read' : '') + (i === selected ? ' sel' : '');
  return '<li class="' + cls + '" data-i="' + i + '" data-key="' + key(p) + '">' +
    '<span class="icon"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"></path></svg></span>' +
    '<div class="body">' +
      '<div class="ptitle">' +
        (p.type ? '<span class="tag ' + tagClass(p.type) + '">' + esc(p.type) + '</span>' : '') +
        (p.scope ? '<span class="scope">' + esc(p.scope) + '</span>' : '') +
        '<a href="#/pr/' + key(p) + '">' + esc(p.title) + '</a> ' +
        '<span class="num">#' + p.number + '</span>' +
      '</div>' +
      '<div class="meta">' +
        '<span>' + esc(p.repo) + '</span>' +
        '<span class="dot">' + esc(p.author) + '</span>' +
        '<span class="dot">' + ago(p.date) + '</span>' +
        '<span class="dot">' + p.filesChanged + ' file' + (p.filesChanged === 1 ? '' : 's') + '</span>' +
        '<span class="adds">+' + p.added + '</span><span class="dels">-' + p.removed + '</span>' +
        (p.prose ? '<span class="hasdesc">described</span>' : '') +
      '</div>' +
    '</div></li>';
}

async function renderList(params) {
  const cur = k => params.get(k) || '';
  const page = +cur('page') || 1;
  const res = await fetch('/api/prs?' + params.toString());
  const data = await res.json();
  ORDER = data.order;

  const active = FACET_KEYS.filter(k => cur(k)).map(k =>
    '<span class="chip">' + k + ': <b>' + esc(cur(k) === '1' && k === 'prose' ? 'described only' : cur(k)) + '</b>' +
    '<a href="#" data-clear="' + k + '">&times;</a></span>').join('');
  const q = params.get('q');
  const chips = active + (q ? '<span class="chip">search: <b>' + esc(q) + '</b><a href="#" data-clear="q">&times;</a></span>' : '');

  app.innerHTML = '<div class="cols"><aside class="side">' +
    facetLinks('Repository', 'repo', META.repos, cur('repo')) +
    facetLinks('Type', 'type', META.types.slice(0, 8), cur('type')) +
    facetLinks('Year', 'year', META.years, cur('year')) +
    facetSelect('Author', 'author', META.authors, cur('author')) +
    facetSelect('Scope', 'scope', META.scopes, cur('scope')) +
    '<div class="facet"><h3>Sort</h3><select data-select="sort">' +
      ['newest', 'oldest', 'largest'].map(s => '<option value="' + s + '"' + (cur('sort') === s || (!cur('sort') && s === 'newest') ? ' selected' : '') + '>' + s + '</option>').join('') +
    '</select></div>' +
    '<div class="facet"><a href="#" data-facet="prose" data-value="1"' + (cur('prose') ? ' class="on"' : '') + '>' +
      '<span>With description</span><span class="n">' + META.withProse + '</span></a></div>' +
    '<div class="stats">' + META.total + ' PRs indexed<br>' + READ.size + ' marked read<br>' +
      'generated ' + META.generatedAt.slice(0, 10) + '</div>' +
    '</aside><section>' +
    '<div class="listhead"><span class="count">' + data.total.toLocaleString() + '</span> pull requests' +
      '<div class="chips">' + chips + '</div><span class="spacer"></span>' +
      '<span style="color:var(--muted);font-size:12px">page ' + data.page + ' of ' + data.pages + '</span></div>' +
    (data.prs.length ? '<ul class="prs">' + data.prs.map(prRow).join('') + '</ul>'
      : '<ul class="prs"><li class="pr"><div class="body empty" style="padding:24px 0">No pull requests match these filters.</div></li></ul>') +
    '<div class="pager">' +
      '<button data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<span class="at">' + data.page + ' / ' + data.pages + '</span>' +
      '<button data-page="' + (page + 1) + '"' + (page >= data.pages ? ' disabled' : '') + '>Next</button>' +
    '</div></section></div>';

  window.__prs = data.prs;
  qBox.value = params.get('q') || '';
}

/* ---------- diff rendering ---------- */

function parseDiff(patch) {
  const files = [];
  let cur = null;
  for (const line of patch.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = { a: m ? m[1] : '?', b: m ? m[2] : '?', rows: [], status: 'modified', add: 0, del: 0, binary: false, oldN: 0, newN: 0 };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) { cur.status = 'added'; continue; }
    if (line.startsWith('deleted file mode')) { cur.status = 'deleted'; continue; }
    if (line.startsWith('rename from ')) { cur.status = 'renamed'; continue; }
    if (/^(rename to |similarity index|dissimilarity|index |old mode|new mode|copy from|copy to)/.test(line)) continue;
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) { cur.binary = true; continue; }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;

    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) { cur.oldN = +h[1]; cur.newN = +h[2]; cur.rows.push({ t: 'hunk', text: line }); continue; }
    if (line.startsWith('\\')) { cur.rows.push({ t: 'meta', text: line.slice(2) }); continue; }
    if (line.startsWith('+')) { cur.rows.push({ t: 'add', n: cur.newN++, text: line.slice(1) }); cur.add++; continue; }
    if (line.startsWith('-')) { cur.rows.push({ t: 'del', o: cur.oldN++, text: line.slice(1) }); cur.del++; continue; }
    cur.rows.push({ t: 'ctx', o: cur.oldN++, n: cur.newN++, text: line.slice(1) });
  }
  return files;
}

function renderFile(f, closed) {
  const name = f.status === 'renamed' && f.a !== f.b ? f.a + ' → ' + f.b : f.b;
  const rows = f.binary
    ? '<tr class="meta-row"><td colspan="3">Binary file not shown</td></tr>'
    : f.rows.map(r => {
        if (r.t === 'hunk') return '<tr class="hunk"><td class="ln"></td><td class="ln"></td><td>' + esc(r.text) + '</td></tr>';
        if (r.t === 'meta') return '<tr class="meta-row"><td class="ln"></td><td class="ln"></td><td>' + esc(r.text) + '</td></tr>';
        const sign = r.t === 'add' ? '+' : r.t === 'del' ? '-' : ' ';
        return '<tr class="' + r.t + '"><td class="ln">' + (r.o == null ? '' : r.o) + '</td>' +
          '<td class="ln">' + (r.n == null ? '' : r.n) + '</td>' +
          '<td class="code">' + esc(sign + r.text) + '</td></tr>';
      }).join('');

  return '<div class="file' + (closed ? ' closed' : '') + '">' +
    '<header><span class="caret">' + (closed ? '▶' : '▼') + '</span>' +
      '<span class="fname">' + esc(name) + '</span>' +
      (f.status !== 'modified' ? '<span class="badge">' + f.status + '</span>' : '') +
      '<span class="fstat"><span class="adds">+' + f.add + '</span> <span class="dels">-' + f.del + '</span></span>' +
    '</header><table class="diff">' + rows + '</table></div>';
}

/* ---------- detail view ---------- */

async function renderPR(repo, number) {
  app.innerHTML = '<div class="loading">Loading #' + number + '...</div>';
  const res = await fetch('/api/pr/' + repo + '/' + number);
  if (!res.ok) {
    app.innerHTML = '<div class="note">PR #' + number + ' is not in the ' + esc(repo) + ' index. ' +
      'It was probably never merged, or landed before the clone’s history begins. ' +
      '<a href="#/' + (listQS ? '?' + listQS : '') + '">Back to the list</a></div>';
    return;
  }
  const p = await res.json();
  const k = key(p);

  if (!ORDER.length) {
    const d = await (await fetch('/api/prs?' + listQS)).json();
    ORDER = d.order;
  }
  const idx = ORDER.indexOf(k);
  const prev = idx > 0 ? ORDER[idx - 1] : null;
  const next = idx >= 0 && idx < ORDER.length - 1 ? ORDER[idx + 1] : null;
  window.__nav = { prev, next, key: k };

  const files = p.diff ? parseDiff(p.diff) : [];
  const body = md(p.description, p.repo);
  const subcommits = p.commits.length
    ? '<div class="card"><header>' + p.commits.length + ' commit' + (p.commits.length === 1 ? '' : 's') + ' in this pull request</header>' +
      '<ol class="subcommits">' + p.commits.map(c =>
        '<li><div class="cs">' + esc(c.subject) + '</div>' +
        (c.body ? '<div class="cb md">' + md(c.body, p.repo) + '</div>' : '') + '</li>').join('') + '</ol></div>'
    : '';

  app.innerHTML =
    '<a class="back" href="#/' + (listQS ? '?' + listQS : '') + '">&larr; Back to pull requests</a>' +
    '<h1 class="dtitle">' + esc(p.fullTitle) + ' <span class="num">#' + p.number + '</span></h1>' +
    '<div class="dsub">' +
      '<span class="merged"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"></path></svg>Merged</span>' +
      '<span><span class="who">' + esc(p.author) + '</span> merged into <b>' + esc(p.repo) + '</b> on ' + p.date.slice(0, 10) + '</span>' +
      '<span class="dot">' + p.filesChanged + ' files</span>' +
      '<span class="adds">+' + p.added + '</span><span class="dels">-' + p.removed + '</span>' +
      '<span class="dot"><code style="font-size:12px">' + p.sha.slice(0, 8) + '</code></span>' +
    '</div>' +
    (p.coauthors.length ? '<div class="note">Co-authored by ' + p.coauthors.map(c => esc(c.replace(/\s*<[^>]*>/, ''))).join(', ') + '</div>' : '') +
    '<div class="card"><header>Description' +
      (p.assistants.length ? '<span class="spacer"></span><span style="font-weight:400;color:var(--muted)">assisted by ' + esc(p.assistants.join(', ')) + '</span>' : '') +
      '</header><div class="pad">' +
      (body ? '<div class="md">' + body + '</div>'
            : '<div class="empty">No description was written for this pull request. ' +
              (p.commits.length ? 'The commit list below is what it carried.' : 'The diff is the whole story.') + '</div>') +
    '</div></div>' +
    subcommits +
    (p.refs.length ? '<div class="note">References ' + p.refs.map(r => '<a href="#/pr/' + p.repo + '/' + r + '">#' + r + '</a>').join(', ') + '</div>' : '') +
    (p.truncated ? '<div class="note">This diff is too large to render in full — showing ' + files.length +
      ' of ' + p.filesChanged + ' files. Run <code>git show ' + p.sha.slice(0, 8) + '</code> in ' + esc(p.repo) + ' for the whole patch.</div>' : '') +
    (p.diffError ? '<div class="note">Could not read the diff: ' + esc(p.diffError) + '</div>' : '') +
    '<div id="files">' + files.map(f => renderFile(f, false)).join('') + '</div>' +
    '<div class="nav">' +
      '<button data-go="' + (prev || '') + '"' + (prev ? '' : ' disabled') + '>&larr; Previous PR</button>' +
      '<button class="readbtn' + (READ.has(k) ? ' on' : '') + '" data-read="' + k + '">' +
        (READ.has(k) ? '✓ Read' : 'Mark as read') + '</button>' +
      '<span class="spacer"></span>' +
      (idx >= 0 ? '<span style="color:var(--muted);font-size:13px">' + (idx + 1) + ' of ' + ORDER.length + '</span>' : '') +
      '<button data-go="' + (next || '') + '"' + (next ? '' : ' disabled') + '>Next PR &rarr;</button>' +
    '</div>';
  window.scrollTo(0, 0);
}

/* ---------- events ---------- */

app.addEventListener('click', e => {
  const facet = e.target.closest('[data-facet]');
  if (facet) { e.preventDefault(); setParam(facet.dataset.facet, facet.dataset.value); return; }

  const clear = e.target.closest('[data-clear]');
  if (clear) { e.preventDefault(); setParam(clear.dataset.clear, null); return; }

  const pageBtn = e.target.closest('[data-page]');
  if (pageBtn && !pageBtn.disabled) {
    const p = new URLSearchParams(listQS);
    p.set('page', pageBtn.dataset.page);
    go(p);
    return;
  }

  const goBtn = e.target.closest('[data-go]');
  if (goBtn && !goBtn.disabled && goBtn.dataset.go) { location.hash = '#/pr/' + goBtn.dataset.go; return; }

  const readBtn = e.target.closest('[data-read]');
  if (readBtn) {
    const k = readBtn.dataset.read;
    if (READ.has(k)) { READ.delete(k); readBtn.textContent = 'Mark as read'; readBtn.classList.remove('on'); }
    else { READ.add(k); readBtn.textContent = '✓ Read'; readBtn.classList.add('on'); }
    saveRead();
    return;
  }

  const fileHead = e.target.closest('.file > header');
  if (fileHead) {
    const f = fileHead.parentElement;
    f.classList.toggle('closed');
    fileHead.querySelector('.caret').textContent = f.classList.contains('closed') ? '▶' : '▼';
    return;
  }

  const row = e.target.closest('li.pr[data-i]');
  if (row && !e.target.closest('a')) location.hash = '#/pr/' + row.dataset.key;
});

app.addEventListener('change', e => {
  const sel = e.target.closest('[data-select]');
  if (sel) {
    const p = new URLSearchParams(listQS);
    if (sel.value) p.set(sel.dataset.select, sel.value); else p.delete(sel.dataset.select);
    p.delete('page');
    go(p);
  }
});

let searchTimer;
qBox.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const p = new URLSearchParams(listQS);
    if (qBox.value.trim()) p.set('q', qBox.value.trim()); else p.delete('q');
    p.delete('page');
    go(p);
  }, 250);
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const r = route();

  if (e.key === '/') { e.preventDefault(); qBox.focus(); qBox.select(); return; }

  if (r.view === 'pr') {
    const nav = window.__nav || {};
    if ((e.key === 'j' || e.key === 'n') && nav.next) location.hash = '#/pr/' + nav.next;
    if ((e.key === 'k' || e.key === 'p') && nav.prev) location.hash = '#/pr/' + nav.prev;
    if (e.key === 'Escape' || e.key === 'b') location.hash = '#/' + (listQS ? '?' + listQS : '');
    if (e.key === 'r' && nav.key) { const b = app.querySelector('[data-read]'); if (b) b.click(); }
    return;
  }

  const rows = [...app.querySelectorAll('li.pr[data-i]')];
  if (!rows.length) return;
  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, rows.length - 1); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); }
  else if (e.key === 'Enter' && selected >= 0) { location.hash = '#/pr/' + rows[selected].dataset.key; return; }
  else return;
  rows.forEach((el, i) => el.classList.toggle('sel', i === selected));
  rows[selected].scrollIntoView({ block: 'nearest' });
});

document.getElementById('theme').addEventListener('click', () => {
  const now = document.documentElement.getAttribute('data-theme');
  const next = now === 'dark' ? 'light' : now === 'light' ? '' : 'dark';
  if (next) { document.documentElement.setAttribute('data-theme', next); localStorage.setItem('fpr-theme', next); }
  else { document.documentElement.removeAttribute('data-theme'); localStorage.removeItem('fpr-theme'); }
});

document.getElementById('help').addEventListener('click', () => {
  alert('Keyboard shortcuts\n\n/        focus search\nj / k    next / previous PR\nEnter    open the selected PR\nn / p    next / previous PR (in detail view)\nr        mark the open PR as read\nb / Esc  back to the list');
});

/* ---------- boot ---------- */

const savedTheme = localStorage.getItem('fpr-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

async function render() {
  const r = route();
  if (r.view === 'pr') return renderPR(r.repo, r.number);
  selected = -1;
  listQS = r.params.toString();
  sessionStorage.setItem('fpr-qs', listQS);
  return renderList(r.params);
}

window.addEventListener('hashchange', render);

fetch('/api/meta').then(r => r.json()).then(m => {
  META = m;
  if (!location.hash && listQS) location.hash = '#/?' + listQS;
  render();
}).catch(e => {
  app.innerHTML = '<div class="note">Could not reach the server: ' + esc(e.message) + '</div>';
});
