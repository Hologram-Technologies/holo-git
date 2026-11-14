# Phase 4 gate: Pull requests

Phase 4 of `docs/PROMPT-UI.md`, built 2026-11-14. This is the gate report: what exists, how it was checked, and what is not done. Phase 5 waits for approval.

## What was built

**The operations** (`web/records.js`, `web/log.js`, `web/identity.js`, `web/sync.js`).

- A pull request used to be named by its branch and commit, so bringing it up to date made a new one and there was nowhere to keep a discussion. It is now named by where it started. When its author proposes a commit that follows the current one, it is the same pull request moved on: same number, same discussion, and approvals start again, because an approval is for one commit.
- A pull request carries a description and its proposer's name.
- New records: a review (comment, approve, request changes), a comment on a line with replies, and the settling of a conversation. Comments, labels, milestones, assignees and closing use the records issues have.
- An approval given by review counts toward the merge gate exactly as the older approval record does. The gate itself, in the proved kernel, is unchanged: enough approvals for this commit, every required check, and a branch that only moves forward.
- Reading is enough to review and comment. Approving needs write access. A conversation may be settled by whoever started it, by the pull request's author, or by a writer.

One existing expectation changed on purpose: `test/pulls.test.mjs` counted seven pull requests after an update; there are now six, and the updated one is merged.

**The screens** (`web/ui/pulls.js`).

| Screen | Address | What it does |
|---|---|---|
| List | `/{owner}/{repo}/pulls` | Open and closed counts, search by words and label, review state and comment count on each row. |
| Conversation | `/pull/{n}` | Description, comments, reviews, updates and conversations on lines; the merge box; comment box; close and reopen; reviewers, assignees, labels and milestone in the sidebar. |
| Commits | `/pull/{n}/commits` | The commits it adds. |
| Checks | `/pull/{n}/checks` | Each check the branch requires, with the result that exists for exactly this content. |
| Files changed | `/pull/{n}/files` | The diff; a comment on any line, with replies and settling; a Viewed tick per file, remembered for the commit; Review changes with comment, approve or request changes. |
| Open from a comparison | `/compare/{branch}...{commit}` | A form under the diff. |
| Across repositories | `/pulls` | Pull requests from every repository in this browser. |

**The merge box** shows, in order: whether changes were requested; required reviews against those given; required checks with each one's state; whether the branch is up to date, with Update branch; and Merge pull request. A refused merge is explained from those facts ("Merging is blocked: at least 1 approving review is required."). The page decides nothing: it attempts the merge, and the log refuses or accepts.

The header's Issues and Pull requests links move into the account menu below 544 px; they did not fit a 360 px screen, which a test caught.
`web/app.js` is down to 210 lines: conflict resolution after a fetch, and the Settings panels.

## Checks

`npm test`: 134 tests, 130 pass, 4 skipped (the storage tests that need credentials). 7 are new.

- **On the operations** (`test/reviews.test.mjs`, 3 tests): a pull request described, discussed, reviewed and merged once a second person approves, with the author's own approval not counting; malformed reviews and line comments refused, and a reader able to review and comment but not approve, settle others' conversations or close; an update by the author keeping number and discussion and clearing approvals, and someone else's following commit being a new pull request.
- **In a real browser engine** (`test/pullui.test.mjs`, 4 tests): a pull request proposed from the editor, commented on, commented on at a line with a reply, reviewed, settled, and merged, with every tab and the lists checked, and an empty line comment and an unknown number as failures; a branch that fell behind brought up to date and keeping its number, a conflict reported, a protected branch refusing a direct commit, and a merge refused for want of a review with the reason shown; opening from a comparison, closing and reopening, and the list across repositories; no sideways overflow at 360 px on six screens.

## Budgets

Compressed script, style and markup: 125 KB gzip in 36 files (limit 300 KB). Speed was not measured in this phase; nothing in it changes the Phase 2 result, which missed the phone-profile budgets.

## Side by side

44 captures at 1280 by 800 and 390 by 844, light and dark, are kept outside the repository beside the Phase 0 references of the same screens. Differences from GitHub:

| Difference | Intended |
|---|---|
| One way to merge: the branch moves forward to the proposed commit. No merge commit, squash or rebase, so no method menu | No. The engine has only this one. |
| A pull request has no head branch, only a commit, so there is no "delete branch" and no pushing more commits to it | No. Follows from the model. |
| Conflicts are reported with the files named; they cannot be resolved in the pull request | No. The resolution editor exists only for fetches. |
| Comments on lines appear in the unified view only | No. |
| No suggested changes | Not built. |
| A request for changes is shown but does not block the merge | No. The gate counts approvals; it has no notion of a blocking review. |
| The title cannot be edited from the page | Not built, though the operation exists. |
| Reviewers are shown by seven characters of their key, or "you" | No. There are no profiles. |
| Nobody can be asked for a review | Not built. |
| A check that passed for identical content reads "Passed", not "Passed (already checked)" | No. The page cannot tell a reused result from a fresh one. |

## Not done, not verified

- **A second person in the browser.** One browser is one person, so the screens were driven as the author. Another person's approval opening the gate is tested on the operations, not on screen; the approved state of the merge box was never seen in a browser.
- **Required checks on screen.** The Checks tab and the checks row were seen only with no checks required. Their states are computed as the old screen computed them.
- **What a merged pull request changed** is read from its first commit's parent. That is right for a pull request of one commit or a straight line of them, and wrong for one that merged the base into itself before merging.
- Old pages cannot read a log holding the new records until they accept the update.
- Speed on the phone profile; accessibility audit; screen reader; any browser but Chromium; the first-time-user script walked by a person.
