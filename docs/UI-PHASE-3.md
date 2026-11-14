# Phase 3 gate: Issues

Phase 3 of `docs/PROMPT-UI.md`, built 2026-11-14. This is the gate report: what exists, how it was checked, and what is not done. Phase 4 waits for approval.

## What was built

Issues did not exist in the product before this phase, so it has two halves.

**The operations** (`web/records.js`, `web/log.js`, `web/identity.js`). Six new kinds of signed record on a repository's log: an issue, a comment, a change to an issue (title, description, state, labels, milestone, assignees), a label, the removal of a label, and a milestone. Each is judged by the kernel like every other record.

- Read access is enough to open an issue and to comment, and for an author to retitle, rewrite, close and reopen their own issue.
- Labels, milestones, assignees, and other people's issues need write access.
- An issue is named by an identifier chosen when it is written. Its number is its place in the log, shared with pull requests. Comments follow the identifier, so an issue written before a fetch keeps them when its number moves.
- Free text is signed in its JSON string form, so a description may hold line breaks without one field posing as another.

**The screens** (`web/ui/issues.js`).

| Screen | Address | What it does |
|---|---|---|
| List | `/{owner}/{repo}/issues` | Open and closed counts; a search box with `is:`, `label:`, `milestone:`, `author:`, `assignee:` and `sort:`; Label, Milestone and Sort menus; labels, milestone, assignees and comment count on each row. `c` starts a new issue, `/` focuses the search. |
| New issue | `/issues/new` | Title and description. |
| Issue | `/issues/{n}` | Title with editing in place; state badge; description and comments as Markdown, with `#12` as a link; a timeline of every change; comment box with Write and Preview; close and reopen; a sidebar for assignees, labels and milestone. |
| Labels | `/labels` | Create, edit, delete, with a live preview and a count of open issues. |
| Milestones | `/milestones`, `/milestones/new`, `/milestones/{id}/edit`, `/milestone/{id}` | Open and closed lists, due date, progress, close and reopen, and the issues in one. |
| Across repositories | `/issues` | Issues from every repository in this browser: created by you, assigned to you, or all. |

The Issues tab carries the open count. The header gains its Issues link, because the screen behind it now exists.
The page never decides who may do what: it attempts the change, and a refusal from the log is shown as "You don't have permission to do that."

## Checks

`npm test`: 127 tests, 123 pass, 4 skipped (the storage tests that need credentials). 9 are new.

- **On the operations** (`test/issues.test.mjs`, 5 tests): what a log means when read; numbering shared with pull requests; malformed and misplaced records refused when written, and an altered comment failing verification; what a person with read access may and may not do; an issue written offline keeping its identity, description, comment and creation time through a fetch that moves its number.
- **In a real browser engine** (`test/issueui.test.mjs`, 4 tests): an issue from an empty list through comment, preview, rename, close, reopen and reload, with a blank title, an empty comment and an unknown number as failures; labels and milestones made, applied, counted and removed, with bad names and colours reported at the field; the list's counts, label filter, word search, sorting and no-match state, and the list across two repositories; no sideways overflow at 360 px on six screens.

The deploy workflow ran them on Linux and passed.

## Budgets

Compressed script, style and markup: 119 KB gzip in 33 files (limit 300 KB).
Speed was not measured in this phase. The machine was close to a full disk and under other load, and Phase 2's numbers already showed the phone-profile budgets missed. Nothing here improves them: each issue screen reads the whole log and checks every signature in it, once per change to the log.

## Side by side

44 captures of the issue screens at 1280 by 800 and 390 by 844, light and dark, are kept outside the repository beside the Phase 0 references. Differences from GitHub seen in them:

| Difference | Intended |
|---|---|
| People are shown by the name they signed with, or by seven characters of their key; assignees always by key, or "you" | No. There are no profiles yet. |
| The assignee menu offers only yourself | No, for the same reason. |
| No projects, due date on an issue, time tracking, dependencies, lock or pin in the sidebar | Not built. |
| No reactions, attachments, edit history, templates, or closing keywords in commits | Not built. |
| Comments cannot be edited or deleted | Not built. |
| The New issue form has no sidebar; labels and milestone are set after | Not built. |
| The search box is the full width of its row only on a phone | Layout difference, not intended. |

## Not done, not verified

- **How a reader's issue reaches the owner.** The operations allow someone with read access to open an issue, and the owner's copy accepts it. Publishing from the page was only tested for people who can also change a branch. Whether a reader can push records alone to shared storage was not tested.
- **The refusal message in the page.** The operations refuse correctly (tested); the browser tests run as the owner, so the "You don't have permission" message was not seen on screen.
- **Old pages cannot read a log that holds issues.** A visitor on the previous version must accept the update first; until then such a repository fails verification for them.
- Pull requests are still the old screen and have no comments; that is Phase 4.
- Mentions, emoji codes, and references to issues in other repositories.
- Notifications and subscriptions (Phase 5).
- Speed on the phone profile; accessibility audit; screen reader; any browser but Chromium; the first-time-user script walked by a person.
