# Phase 7 gate: Around the code

Phase 7 of `docs/PROMPT-UI.md`, built 2026-11-15. This is the gate report: what exists, how it was checked, and what is not done. Phase 8 waits for approval.

## What was built

Four tabs join the repository header, in this order: Code, Issues, Pull requests, Projects, Releases, Wiki, Activity, Settings.

**Releases** (`web/ui/around.js`).

| Screen | Address | What it does |
|---|---|---|
| List | `/{owner}/{repo}/releases` | Every release, newest first, with its notes; the newest full release is marked Latest, a pre-release is marked as one. |
| New, edit | `/releases/new`, `/releases/edit/{tag}` | Tag, target branch, title, notes in Markdown, pre-release. |
| One release | `/releases/tag/{tag}` | The release with links to its commit and its files; Edit and Delete, the latter confirmed. |

**Wiki.**

| Screen | Address | What it does |
|---|---|---|
| Page | `/wiki`, `/wiki/{page}` | The page as Markdown, the list of pages beside it, who edited it last. `[[A title]]` links to that page; a link to a page that does not exist offers to create it. |
| New, edit | `/wiki/_new`, `/wiki/{page}/_edit` | Title and content; Delete page, confirmed. |
| History | `/wiki/{page}/_history` | Every save, newest first; each opens that version, marked as an older one. A deleted page keeps its history. |

**Projects.**

| Screen | Address | What it does |
|---|---|---|
| List | `/projects` | Open and closed boards with their item counts. |
| New, edit | `/projects/new`, `/projects/{n}/edit` | Name and description. A new board starts with To do, In progress and Done. |
| Board | `/projects/{n}` | Columns of cards. Add an open issue or pull request to a column; move a card by dragging it or from its menu; remove it. Add, rename and delete columns. Close and reopen the board. |

**Activity** (`web/ui/activity.js`).

| Screen | Address | What it does |
|---|---|---|
| Pulse | `/activity` | For 24 hours, a week or a month: pull requests merged and opened, issues closed and opened, releases published, and how many authors made how many commits. |
| Contributors | `/activity/contributors` | Each author on the default branch with their commit count and the dates of their first and last commit. |
| Commits | `/activity/commits` | Commits week by week over the last year. |

**Underneath.** Releases, wiki pages, projects and cards are four new signed operations (`web/records.js`, `web/log.js`, `web/identity.js`). All four need write access, and that is decided where every other change is decided, not in page code. They travel with the repository when it is published and fetched, like issues do. Activity stores nothing; it is counted from the history and the discussion each time.

## Checks

`npm test`: 148 tests, 144 pass, 4 skipped (the storage tests that need credentials). 5 are new.

- **The operations** (in `test/issues.test.mjs`): a release created, edited and removed, a duplicate tag, a malformed tag and a target that is not a commit refused; wiki pages saved, saved again and removed, with their history; a board with its default columns, cards moved, a card for an unknown item or column refused, a dropped column taking its cards; a person with read access refused.
- **In a real browser engine** (`test/around.test.mjs`, 4 tests):
  - Releases: publish with notes; pre-release; Latest lands on the right one; edit; delete after confirming; a blank, malformed and taken tag each refused at the field; a deleted release's address says there is none.
  - Wiki: first page; a `[[link]]` to a missing page, then creating it; edit; history and reading an older version; delete; a blank, malformed and taken title each refused.
  - Projects: create; add two cards; move one by menu and one by dragging above another; add, rename and delete a column; remove a card; close; a blank project name and a blank column name refused; an unknown project number says there is none.
  - Activity: the numbers and the sentence after one issue, one release and two commits; the period menu; contributors; the weekly bars adding up; an unknown page not found.
  - No sideways overflow at 360 px on eleven screens.

## Budgets

Compressed script, style and markup: 149 KB gzip in 38 files (limit 300 KB). Speed was not measured in this phase; the phone-profile misses reported since Phase 2 stand.

## Side by side

64 captures at 1280 by 800 and 390 by 844, light and dark, are kept outside the repository. There are no reference captures for these screens: this phase could not reach GitHub or Gitea to take them, so the comparison below is from the Phase 0 study and from memory of the two products, not from fresh captures.

| Difference from GitHub and Gitea | Intended |
|---|---|
| A release does not create a git tag. It names its tag and the commit; an existing tag of that name is used as it is. | No. See "Not built". |
| A release has no downloadable files and no generated source archives; it links to the files at its commit, where Download ZIP is. | No. |
| No draft releases. | No. |
| The wiki is not a git repository of its own; it cannot be cloned, and a page is not a file. | Yes. It travels with the repository instead. |
| A wiki page cannot be renamed, and there is no custom sidebar or footer page. | No. |
| A board has columns of issues and pull requests only: no notes, no table view, no custom fields. | Yes for the table view and fields; no for notes. |
| A card is dragged with a mouse; on a touch screen it is moved from its menu. | No. |
| Activity has Pulse, Contributors and Commits. No code frequency, no punch card. | No. See "Not built". |
| Pulse counts commits on the default branch only. | Yes. |

## Not built

- **Creating the git tag with a release.** A tag is a change to the repository's refs with its own rule in the model. Doing it from the release form is a small step, but it was not taken and not tested here.
- **Release files** (uploaded binaries) and **draft releases**.
- **Code frequency** (lines added and removed per week). It needs every commit compared with its parent; on a long history that takes too long to do on each visit, and there is nowhere it is kept. Not built rather than built slow.
- **Wiki rename, sidebar and footer pages, and comparing two versions.**
- **Notes on a board, and dragging a card on a touch screen.**
- **Projects in the issue and pull request sidebar.** A card is added from the board, not from the item.
- **Activity across forks, and the dependency and network graphs.** There are no forks.

## Not verified

- Dragging with a real pointer. The test sends the browser's own drag events with the position of the drop; it does not move a mouse.
- Two people: a release, page or board made by one and received by another after publish and fetch. The operations ride the same signed history as issues, whose two-person path is tested, but these four were not walked through it in a browser.
- A person with read access in the browser. The refusal is tested at the operation; the screens show "You don't have permission" from the same path issues use, and that message was not driven here.
- Contributors and the weekly chart on a long history; the count stops at the newest 1,000 commits and says so.
- Speed on the phone profile; accessibility audit; screen reader; any browser but Chromium; the first-time-user script walked by a person.
