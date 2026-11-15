# Phase 8 gate: Automation

Phase 8 of `docs/PROMPT-UI.md`, built 2026-11-15. This is the gate report: what exists, how it was checked, and what is not done. Phase 9 waits for approval.

The prompt's line for this phase is "Actions screens over the checks; packages". The Actions screens were built over the checks as they are today. Packages were not built; the reason is under "Stopped".

## What was built

An Actions tab sits after Pull requests (`web/ui/actions.js`).

| Screen | Address | What it does |
|---|---|---|
| Checks and results | `/{owner}/{repo}/actions` | The checks the repository describes, listed on the left. Where a branch stands: each check as passed, failed, or not run for the branch's newest commit. Under it, every result ever reported, newest first, with who reported it and which branches it speaks for now. Filters by check, branch, status and person, kept in the address. |
| One result | `/actions/runs/{address}` | The check as one job: the tools it confirms, the command it runs and where; what it reads, the environment it is given, what it needs and produces; which branches the result applies to; and every result reported for the same content. |

With nothing set up, the screen says where checks are described and that they run on a contributor's machine.

**What a result is.** A check is named by what it reads. A result is for that content, not for a commit: it holds for every commit whose files the check reads are the same, and stops speaking for a branch when one of those files changes. The screens show exactly that. After a change to a file a check reads, the branch shows "Not run for this commit" and the old result stays in the list with no branch beside it.

**Underneath.** The reading of the signed history now keeps every check result, not only the newest for each content (`web/log.js`). Nothing new is signed in this phase.

**A fault found and fixed.** A label or a check result carries the label's or the check's name in the field where other operations carry the signer's name. The reading of the history took it for the person's name, so after someone made a label called "bug", their comments could be shown as written by "bug". Fixed in `web/log.js`; the Actions test covers it.

## Checks

`npm test`: 149 tests, 145 pass, 4 skipped (the storage tests that need credentials). 1 is new.

- **In a real browser engine** (`test/actions.test.mjs`): nothing set up; a checks file committed and both checks shown as not run; three results reported the way a runner sends them, signed under the address of the content; where the branch stands; the list, filtered by status, by check, and to nothing with a way to clear; one result with its steps, what it reads, no output, and both results for the same content; a file the check reads changed, so the branch shows not run and the old result says no branch is at that content; an unknown result address and an unknown page; the person shown by their own name; no sideways overflow at 360 px on four screens.

## Budgets

Compressed script, style and markup: 153 KB gzip in 39 files (limit 300 KB). Speed was not measured in this phase; the phone-profile misses reported since Phase 2 stand.

## Side by side

28 captures at 1280 by 800 and 390 by 844, light and dark, are kept outside the repository. No reference captures were taken in this phase; the comparison is from the Phase 0 study.

| Difference from GitHub and Gitea | Intended |
|---|---|
| A row is a result for some content, not a run of a workflow on a commit. It has no number, no duration and no trigger. | Yes. That is what a check is here. |
| A run has one job, and its steps are the declared tools and the one command. | Yes. |
| There is no output for a run. | No. See "Not built". |
| Nothing can be started, re-run or cancelled from the page. | No. A check runs on a contributor's machine. |
| The branch filter shows results that speak for the branch's newest commit, not every run that ever happened on the branch. | No. Older commits are not matched to results. |
| The path of the checks file is shown, and it contains a word the interface otherwise never shows. | No. It is the real path a person must type. It comes from the code's constant, not from the strings file, so the word scan does not see it. This needs a decision along with the product name. |

## Stopped: packages

The prompt asks for Packages, and `docs/PARITY.md` lists container and generic packages as adapted because peers "already speak these". Nothing in this repository speaks them.

A package registry is an address that a package client talks to: `docker pull`, `npm install`, `curl`. This product has no server, and a page in a browser cannot answer those clients. What a page could do is keep uploaded files and list them. That would be a file shelf with the name Packages on it, which no package client could use, and files kept that way would not yet travel with the repository when it is published. That is the hollow version the prompt forbids.

So this is a stop, as the prompt asks. Packages need a peer that serves a registry protocol, which is work outside the interface. Until then there is no Packages tab and no Packages on a profile.

## Not built

- **Output and artifacts of a run.** Only pass or fail is signed. Keeping output needs a place for it that travels with the repository and a decision on what a runner may publish.
- **Starting, re-running or cancelling from the page; running by hand with inputs.** There is nothing in the browser that can run a compiler or a test suite.
- **Workflow files in GitHub Actions syntax.** Checks are described in the repository's own checks file. Nothing reads `.github/workflows`.
- **Actions settings: runners, secrets, variables.** There is no pool of runners to list, and no secrets or variables exist. A runner is anyone with write access; they are managed under Collaborators.
- **Scheduled runs, status badges, disabling a check from the page.**
- **A results column in the commit list and on the branch list.** The pull request page already shows required checks; other lists do not show status yet.

## Not verified

- Results reported by the command-line runner against a published repository and then read in the browser. The test reports results through the same signing call the runner uses, inside the page.
- Results reported by a second person, and the Person filter with more than one person.
- A repository with many branches. Each branch's standing is worked out on every visit, for up to 30 branches.
- A check that needs another check's product. It is shown as "Waits for another check"; that path has no browser test.
- Speed on the phone profile; accessibility audit; screen reader; any browser but Chromium; the first-time-user script walked by a person.
