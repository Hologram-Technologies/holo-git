# Phase 9 gate: Finish

Phase 9 of `docs/PROMPT-UI.md`, built 2026-11-15. The prompt's line for this phase is "Accessibility audit, performance budget, the string review, the 'What is different' page". This is the gate report for those four, followed by where the whole rebuild stands.

## Accessibility audit

**What was run.** The project's own audit (`test/audit.mjs`), over 62 screens and four open overlays, each in light and in dark, and six screens again at 360 px (`test/a11y.test.mjs`). It runs in a real browser engine on a repository that has one of everything. It checks, against WCAG 2.2 AA: every control has a name; form controls have labels; references between elements lead somewhere; no id is used twice; images and icons are named or hidden; text contrast of 4.5 to 1, or 3 to 1 for large text; one top heading per screen and no skipped level; one main region and named navigations; a page title and language; and targets of 24 by 24 px, with the spacing exception.

It is not a standard tool. A standard one was to be added as a development dependency; installing it was refused in this session, and the prompt forbids downloading and running things, so the audit was written here instead. Its limits are listed in its first lines and under "Not verified".

**What it found, all fixed.**

| Finding | Where | Fix |
|---|---|---|
| Initials on avatars under 4.5 to 1 (as low as 3.2) | every avatar, both themes | avatar colours now come from the eight backgrounds meant to carry white text; all are 4.5 or more in both themes |
| Text on issue labels under 4.5 to 1 | labels in mid-tone colours, where neither white nor dark text reads | light colours take dark text, dark ones white; a colour in between is shown a little darker, same hue, until white reads. The first fix was not enough: a new label gets a random colour, and the build machine drew one that still failed. The test now makes a label in such a colour on purpose |
| No top heading | 25 screens, most of them under a repository | every screen now has one; where the design shows none, the screen's name is there for a screen reader |
| Empty states used a third-level heading under a first-level one | every empty state | second level |
| The Write and Preview strip was an unnamed navigation | every comment box | named |
| Footer buttons under 24 px high | every screen | 24 px |
| A title link too close to the link under it | list rows with a link in their second line | the title is 24 px high and the second line stands 4 px off |

**Exception claimed.** Line numbers beside code are 20 px high, one to a line, and each is a link. Their size is what they are, so they are excepted as essential, as the criterion allows.

## Performance budget

Measured on the phone profile the earlier phases used: 390 px wide, processor slowed four times, service worker in place, a copy of this project's repository with 34 commits. Navigation is timed until the new screen is in the page and the frame that draws it has been produced. Each figure is a median; the range is across three or four runs of the whole measurement, which differ by as much as 70 ms on this machine.

| Budget | Limit | Before this phase | Now |
|---|---|---|---|
| Compressed script, style and markup | 300 KB | 153 KB | 154 KB, met |
| First paint of the cached Code tab | 200 ms | 136 ms | 140 to 212 ms; met in most reloads, not all |
| Code to a folder and back | 100 ms | 109 ms | 104 to 135 ms; into a folder is met, back to the Code tab is **missed** |
| Opening a 300-line file | 100 ms | 240 ms | 98 to 126 ms; at the limit |
| Between Issues, Pull requests and Code | 100 ms | 77 ms | 48 to 61 ms, met |
| Activity and Actions | 100 ms | 102 ms | 49 to 58 ms, met |

Three changes made the difference.

- **Objects read from storage are kept in memory once they have been checked** (`web/store.js`). A commit or a folder was fetched from the browser's storage and judged again on every screen. Now the bytes that passed are kept while the page lives, and those same bytes are handed out, so nothing unjudged is used. A write to the same name, or opening another store, forgets them; objects over 64 KB are not kept. This changes one thing worth knowing: bytes altered in storage after they were first read are not noticed until the page is reloaded. What the page shows is still only what was verified.
- **Slow reading waits for the paint** (`web/ui/code.js`). The last commit for each row, the README and the language bar started before the new screen was drawn and competed with it.
- **A long file is drawn in two parts.** The first 120 lines at once, the rest after the paint. An address that names a line draws everything first, so the line can be scrolled to.

**Still missed.** Returning to the Code tab takes 130 to 200 ms to reach the screen, though its content is in the page by about 85 ms; drawing the file table with the README box is the cost. Opening a file and the first paint sit at their limits and go over in some runs. The measurement itself is too noisy on this machine to say more than that. Joining the 39 files into one was not done; it would help the first visit, not these numbers, which are taken with everything already cached.

## String review

The strings file was read as a whole, and three checks were added so the review holds (`test/words.test.mjs`).

- **Nothing left over.** Every string must be shown somewhere. Thirteen were not, and are removed: among them "New organization" and "Your profile", which named things that were never built.
- **The banned-word scan now catches word forms.** "Recorded" had passed where "record" would not. It was in the email hint on the first-run screen; that now reads "Written into your commits."
- Two lines on the Actions run page used "content" where a GitHub user would say files. They now read "no branch has these files now" and "Every result for these files".

The file holds 782 strings. Two words the scan does not see are shown on purpose and need a decision: the product's name, and the path of the checks file.

## The "What is different" page

`/different`, linked from the footer on every screen and readable without signing in (`web/ui/pages.js`). Eight short points: there is no account; repositories live in this browser; issues and reviews travel with the repository; collaborators are added by key; what is shown was verified; checks run on your own machine; search covers what this browser holds; and what is not here. It passes the audit and fits at 360 px.

## Checks

`npm test`: 152 tests, 148 pass, 4 skipped (the storage tests that need credentials). 3 are new.

New in this phase: the audit over every screen; the page that says what is different; "nothing left over" in the strings file. Six older test files changed only where they named the empty state's heading level.

Captures: 4 of the new page, kept outside the repository.

## Where the whole rebuild stands

Built and tested, phase by phase: the foundation and first run; Code; Issues; Pull requests with review on lines; Home, profile, explore, notifications, search and the command palette; repository and user settings; releases, wiki, projects and activity; Actions over the checks. Each phase's report (`docs/UI-PHASE-1.md` to `8`) lists its own gaps. The ones that matter most, together:

**Stopped, because the design has no place for them yet.**
- Organisations and teams (Phase 6): the proved model has no such rules, and the page may not decide who may do what.
- Packages (Phase 8): nothing can answer a package client without a server.

**Not built.**
- Markdown: footnotes, emoji codes, mentions, code highlighting, diagrams and math.
- Shortcuts `j` and `k` in lists.
- The Verified badge on commits.
- Stars, forks and following; reactions.
- A release creating its git tag; release files; code frequency; output of a check run.
- Description and default branch as signed changes: they are kept in this browser only.

**Never done, and not something this work can do alone.**
- An accessibility audit by a person, with a screen reader, and with a standard tool.
- The first-time-user script walked by a person who has not seen the interface. Every gate asked for it; none had it.
- Any browser but Chromium.
- Reference captures beside ours for the screens of phases 6 to 9.

**Decisions waiting.**
- The product's name contains a word the interface otherwise never shows.
- The checks file path does too.
- "Push" or "Publish" as the one word for sending changes: both are used, Publish the first time and Push after.

## Not verified in this phase

- Focus order and focus visibility on every screen; what a screen reader announces; the contrast of borders and icons; zoom to 200 percent; the high-contrast themes. The audit covers none of these.
- The audit at widths other than 1280 and 360, and with themes other than light and dark.
- Speed on a real phone. The numbers are from a slowed desktop processor, which is an estimate.
- Speed on a large repository. The one measured has 34 commits.
