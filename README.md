# Offline PR Archive

Rebuild a browsable, GitHub-styled pull request history from local git clones — no network, no API, no GitHub account.

When you lose access to an organisation, the code in your clones survives but the pull requests seem to vanish: PRs live on GitHub's servers, not in `.git`. Most of them are recoverable anyway. If the org squash-merged, **every merged PR is a commit** whose subject carries its number and title and whose body carries the description someone wrote:

```
fix(app): update total cashback on the giftcard success screen (#2787)

The total was only incremented once the redeem screen's polling saw the
purchase as completed. If that screen unmounted first, the local total was
never incremented and the dashboard stayed stale until the next login.
```

That is a pull request: number, title, author, date, description, and the complete diff. This tool indexes them and serves them back in an interface that reads like the one you lost.

## Usage

```sh
node extract.js /path/to/your/repos   # index every clone in that directory
node server.js                        # http://localhost:4000
```

No dependencies and no build step — just Node and `git` on your PATH. Re-run `extract.js` whenever the clones change.

`extract.js` scans the given directory for anything containing a `.git`, so point it at the parent folder holding your clones and it picks up all of them at once.

## What it shows

Each indexed PR gets the heading, conventional-commit type and scope badges, author, date, diffstat, the description where one was written, the list of squashed sub-commits, and the full split diff with line numbers and add/delete highlighting.

- **Filter** by repository, type, year, author and scope
- **Search** across titles and description bodies
- **Read PRs in sequence** — `j`/`k` to move, `Enter` to open, then `n`/`p` to walk the filtered set one by one
- **Track progress** — mark PRs read; state persists in local storage
- **Cross-references** — a `#1234` inside a description links to that PR
- Light and dark themes, following the system by default

| Key | |
|---|---|
| `/` | focus search |
| `j` / `k` | next / previous PR |
| `Enter` | open the selected PR |
| `n` / `p` | next / previous PR while reading one |
| `r` | mark the open PR as read |
| `b` / `Esc` | back to the list |

## What it cannot show

Review comments, approvals, requested changes, labels, CI results and linked issues were never in the clone. They are not recoverable without access to the original host. This gives you the what, and — wherever an author wrote one — the why.

Coverage depends entirely on how the team merged. Squash-merge with written PR descriptions reconstructs almost completely; merge commits without bodies leave you the title and the diff. Expect a meaningful share of any real history to be title-only, and note that repositories differ widely: infrastructure repos are often far better documented than application ones.

## How it works

- **`extract.js`** — walks each clone once with `git log --all --numstat`, matching `subject (#123)` and `Merge pull request #123 from …`. Squash bodies are split into a description plus the sub-commit list; `Co-authored-by` and similar trailers are lifted out of the prose and reported separately. Where a rebase or cherry-pick left several copies of one PR, the copy that landed on the default branch wins. Output is a single `prs.json`.
- **`server.js`** — loads `prs.json` into memory for filtering and search, and shells out to `git show` for each diff on demand. Nothing is duplicated on disk, so even a patch with hundreds of thousands of changed lines opens instantly; very large diffs are capped and flagged in the UI.
- **`public/`** — the interface. Plain HTML, CSS and JavaScript, no framework and no outbound requests.

## Privacy

`prs.json` contains the titles, descriptions and author emails of the repositories you indexed, so it is gitignored by default. Keep it that way if the history it came from is private.
