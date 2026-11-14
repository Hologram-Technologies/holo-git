# Phase 2 gate: Code

Phase 2 of `docs/PROMPT-UI.md`, built 2026-11-14. This is the gate report: what exists, how it was checked, and what is not done. Phase 3 waits for approval.

## What was built

Addresses are `/{owner}/{repo}/...`. An address from before owners existed is sent on to its new form.

| Screen | Address | What it does |
|---|---|---|
| Code | `/{owner}/{repo}`, `/tree/{ref}/{path}` | Branch and tag switcher; branch and tag counts; file finder (`t`); Add file; the Code button with the clone address, Download ZIP and Download bundle; latest-commit bar with the commit count; file table with each row's last commit and its age; rendered README; sidebar with search, About and a languages bar. |
| File | `/blob/{ref}/{path}` | Numbered lines; a line or a range selected by click and Shift-click and kept in the address (`#L3-L9`); permanent link (`y`); Raw, copy, download; Edit (`e`); History; Blame (`b`). Markdown is rendered, with a switch to its source. Images kept in the repository are shown. |
| Blame | `/blame/{ref}/{path}` | Each line with the commit that last changed it, its author and age. |
| Commits | `/commits/{ref}`, `/commits/{ref}/{path}` | Grouped by day, thirty to a page; the history of one file. |
| Commit | `/commit/{sha}` | Message, author, parents; a list of changed files; each file's diff, unified or split (remembered), folded per file. |
| Compare | `/compare/{base}...{head}` | The same diff view between any two branches, tags or commits. |
| Branches, tags | `/branches`, `/tags` | Lists with the last commit; Compare against the default branch. |
| Search | `/search?q=` | Text search of the default branch, in the browser; results open the file at the line. |
| Editor | `/edit/{branch}/{path}`, `/new/{branch}/{path}` | Edit a file or add one; commit directly, or to a new branch with a pull request. |

Behind them: `web/ui/repo.js` (finding the repository, reading a ref and path from an address, header, switcher), `web/ui/code.js`, `web/ui/history.js`, `web/ui/markdown.js`, `web/ui/zip.js`.
Markdown is turned into DOM nodes and never parsed as HTML; raw HTML in a document is shown as text. An image at another address is shown as a link, because loading it would be a request to someone else's server.
The old files, commits, blame and editor screens are deleted. `web/app.js` went from 526 lines to 329.

## Checks

`npm test`: 118 tests, 114 pass, 4 skipped (the storage tests that need credentials). 8 are new, all in a real browser engine (`test/code.test.mjs`), each through a main path and a failure:

- Code: file order, each row's last commit, rendered README, commit count, into a folder and back, an old-style address; a missing branch and a missing file.
- File finder: `t`, typing, Enter; no match.
- File: a selection carried by a cold deep link, click, Shift-click, reload; `y`, `b`; blame credits all three commits; Markdown and its source; blame of a missing file.
- Commits: list, one file's history, a commit's counts and rows, split view with equal halves, remembered choice, folding, compare across three files; an unknown commit and an empty compare.
- Branches, tags, search; no results.
- Editor: add a file, edit it, commit count; blank name, no changes, editing at a commit.
- Markdown: thirteen constructs render; a hostile document produces no script, image, event handler or `javascript:` link.
- Seven Code screens do not overflow at 360 px.

The deploy workflow ran these on Linux and passed.

## Budgets

Measured 2026-11-14 on this project's own repository (34 commits, about 150 files), viewport 390 by 844. The machine was under other load (about 45 percent).

| Budget | Limit | No slowdown | CPU slowed four times |
|---|---|---|---|
| Script, style and markup, compressed (32 files) | 300 KB | 107 KB gzip | |
| First paint of the cached Code tab | 200 ms | 64 to 80 ms | 180 to 344 ms over three runs; **missed** in most reloads |
| File table on screen after a reload | none set | 81 to 108 ms | 392 to 682 ms |
| Navigation between Code and a folder | 100 ms | 6 to 38 ms | 85 to 336 ms; **missed** in about half |
| Opening a 300-line file | 100 ms | 34 ms | 336 ms in the last run; **missed** |

On the phone profile the speed budgets are not met. Two things were done about it in this phase: the screen is drawn before the slow reading starts (last commit per row, README, languages), and that reading stops when the visitor moves on and is remembered by content. What remains is the cost of the first paint (three stylesheets and nineteen script files loaded one by one) and of re-verifying every object on every read, which the product does on purpose. Joining the files is the next step; it was not done here.

## Side by side

46 captures of the Code screens at 1280 by 800 and 390 by 844, light and dark, are kept outside the repository, beside the Phase 0 reference captures of the same screens on GitHub and Gitea. Differences seen, and whether they are intended:

| Difference from GitHub | Intended |
|---|---|
| No syntax highlighting in files or diffs | No. Not built. |
| No file tree panel beside a file or a commit | No. Not built. |
| No Watch, Fork, Star or visibility badge in the header | Yes for now: those features are not built, so their buttons are absent. |
| Tabs are Code, Pull requests, Settings only | Yes: a tab appears when its screen exists. |
| The sidebar has no topics or releases | Yes for now, same reason. |
| The branch switcher has no filter box | No. Fine for a few branches, not for many. |
| The diff has no expand-context control and no whitespace switch | No. Not built. |
| The owner of a repository opened by address is taken from the address | Yes, until owners are real. |
| Dates in the commit list group by the visitor's local day | Yes. |

## Not done, not verified

- Syntax highlighting; the file tree panel; rename detection (a rename shows as a removal and an addition, as before).
- Whitespace switch and expand-context in diffs; comments on lines (Phase 4).
- Delete, rename and upload of files. Creating, deleting and renaming branches and tags from the page.
- `l` (jump to line) and `.`; the command palette.
- Compare uses the two trees directly, not their common ancestor.
- Markdown: no footnotes, emoji codes, mentions or issue references, diagrams or math.
- Search is plain text on the default branch only, capped at 3,000 files; there is no index.
- The Verified badge is not shown on commits. The data to decide it exists for commits made in the page; it is not wired.
- Owners are not real: repositories are still stored by name alone, so two with the same name from different owners cannot both be held.
- The Settings tab holds the old fetch, push, storage-key, access and branch-protection panels with their old wording (18 strings with a banned word remain, all there and in pull requests).
- Download ZIP holds every file in memory at once and stores them uncompressed.
- One browser engine. No screen reader. No accessibility audit.
- The first-time-user script was not walked by a person.
- Once during this phase two older tests (publishing to a remote) failed when the whole suite ran beside other work on the machine, and passed on the next three runs. They were not changed.
