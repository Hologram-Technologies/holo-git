# Phase 5 gate: Home

Phase 5 of `docs/PROMPT-UI.md`, built 2026-11-14. This is the gate report: what exists, how it was checked, and what is not done. Phase 6 waits for approval.

## What was built

Everything on these screens is worked out in the browser from the repositories it holds (`web/ui/home.js`). Nothing is asked of anyone else.

| Screen | Address | What it does |
|---|---|---|
| Dashboard | `/` signed in | A feed of pushes, merges, issues, pull requests, comments and reviews, newest first; a year of your contributions as a heatmap; the repository list with a filter and All, Sources and Collaborative. |
| Profile | `/{owner}` | Name and avatar; for yourself, the heatmap; the owner's repositories and recent activity; Overview and Repositories tabs. |
| Explore | `/explore/repos`, `/explore/users` | Repositories and owners, with a search box. |
| Notifications | `/notifications` | What others did on the issues and pull requests you take part in: unread and all, mark one or all as read. Opening the issue or pull request marks it read. A dot on the bell when something is unread. |
| Search | `/search?q=` | Repository names and descriptions, and the titles and text of issues and pull requests, with a count per kind. |
| Command palette | `Ctrl+K`; `Ctrl+Alt+K` inside a text field | Go to any repository or screen, the current repository's tabs, or switch theme. Letters in order, spaces ignored. |

The header now carries everything the prompt lists: mark, search box (`/` focuses it), Issues, Pull requests, Explore, the bell, the create menu and the account menu. Below 544 px the links are in the account menu.

**Names.** The log now keeps the name each person last signed with. Reviewers, assignees, feed entries and notifications show that name where a key was shown before. It is what a person calls themselves; nothing verifies it.

## Checks

`npm test`: 138 tests, 134 pass, 4 skipped (the storage tests that need credentials). 4 are new, all in a real browser engine (`test/home.test.mjs`):

- Dashboard, profile and explore: the feed's wording, a year of days with today coloured and in view, the repository list and its no-match state, a profile and an unknown one, explore and its no-match state.
- Search and the palette: `/` focuses the box, counts per kind, results and no results; the palette switches theme and opens a repository, says when nothing matches, and stays shut for `Ctrl+K` inside a text field.
- **Two people, one remote.** Two browsers with separate storage and one shared store. Ada creates a repository, an issue and access for Bob, and publishes. Bob opens it by address, comments, and publishes. Ada fetches: a dot on the bell, one unread notification naming Bob, his comment under his name, and the notification read once she has opened it. Then a rule asks for one approving review; Ada proposes a change; Bob fetches, approves by review and publishes; Ada fetches, her merge box reads "Changes approved", and the merge goes through.
- No sideways overflow at 360 px on six screens.

That third test settles three things earlier reports listed as not verified: another person's approval opening the merge gate on screen (Phase 4); a person publishing records without having changed a branch (Phase 3); and names shown for other people.

## Budgets

Compressed script, style and markup: 133 KB gzip in 37 files (limit 300 KB).
Speed was not measured in this phase. The dashboard is drawn first and filled in after, but filling it reads every repository's log and up to 500 commits of each; on a browser holding many repositories that will be slow, and it was only exercised with two.

## Side by side

40 captures at 1280 by 800 and 390 by 844, light and dark, are kept outside the repository. The Phase 0 references for the dashboard and notifications do not exist (they need sign-in); the user's own picture of Gitea's dashboard is the reference for the layout: heatmap, feed below, repository list on the right.

| Difference | Intended |
|---|---|
| Explore and search cover only repositories this browser holds, and say so | Yes. There is no index anywhere to ask. |
| No Organizations in Explore; no Forks or Mirrors tab on the repository list | Yes: those features do not exist yet. |
| The feed and heatmap show activity in repositories held here, not everything a person did | Yes, for the same reason. |
| A profile is a name, an avatar made of initials, and repositories. No bio, no follow, no stars, no avatar image | Not built. A profile is not yet a signed document others can read. |
| Notifications appear after a fetch, not as things happen | Yes: nothing pushes to a browser. |
| No watching a repository, no subscribing to one issue, no notification settings | Not built. |
| Global search does not search code | Not built; code search is per repository. |
| The palette has no modes (`>` for commands, `#` for issues) | Not built. |

## Not done, not verified

- Read marks are kept in this browser only. Reading a notification on one device does not mark it read on another.
- The owner shown for a repository is still derived, not real, so a profile is "whoever these repositories came from".
- Unread counts are computed on every screen from every log. Not measured.
- Speed on the phone profile; accessibility audit; screen reader; any browser but Chromium; the first-time-user script walked by a person.
