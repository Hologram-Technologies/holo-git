# Phase 6 gate: Settings and people

Phase 6 of `docs/PROMPT-UI.md`, built 2026-11-14. This is the gate report: what exists, how it was checked, and what is not done. Phase 7 waits for approval.

This phase is the one where the prompt asks for more than the product's model holds. What the model has was rebuilt in full. Organisations and teams, which the model does not have, were not built; the reason is under "Stopped".

## What was built

**Repository settings** (`web/ui/reposettings.js`), under the Settings tab.

| Page | Address | What it does |
|---|---|---|
| General | `/{owner}/{repo}/settings` | Description; default branch; a danger zone with rename, and delete with the name typed to confirm. |
| Collaborators | `/settings/collaborators` | The owner and everyone with access, with role and expiration; add a person by their sign-in key as Read or Write for 7, 30 or 90 days or without expiration; remove. |
| Branches | `/settings/branches`, `/new`, `/edit?branch=` | Protection rules: who can push, required approvals, required checks; create, edit, delete. |
| Remote | `/settings/remote` | The address the repository is published to; Fetch; Publish the first time and Push after; storage keys kept for the tab; every failure explained in the visitor's terms with what to do. |
| Resolve conflicts | `/resolve` | After a fetch that conflicts: each file between markers, or a choice of version; Commit merge. |

A repository whose changes are not yet published carries "Not published" beside its name, once it has been published or fetched at least once.

**User settings** gain Repositories (each with a link to its settings) and Storage (where data is kept, the space used, and a request that the browser not clear it automatically).

**Storage** (`web/store.js`) can rename and remove a repository in this browser. A renamed repository's signed history still verifies, because what was signed keeps the name it was signed under.

**The old interface is gone.** `web/app.js` and `web/style.css` are deleted. No screen is left with the old wording: the scan covers every string the build can show, with no baseline of exceptions.

## Checks

`npm test`: 143 tests, 139 pass, 4 skipped (the storage tests that need credentials). 5 are new.

- **Storage** (in `test/issues.test.mjs`): rename and remove; the history verifying under the new name and taking new changes; a taken name and a missing one refused.
- **In a real browser engine** (`test/settings.test.mjs`, 4 tests):
  - General: description saved and shown on the Code tab; a bad name refused at the field; rename; delete only once the name is typed.
  - Collaborators and rules: a malformed key and one's own key refused; a collaborator added with role and expiration, then removed; a rule refused for a bad number and a bad check name, created, seen to refuse a direct commit, edited, deleted.
  - The remote, with two people: not an address, nothing to publish, and a dead address each explained; Publish, then Push; a second person opens the repository, changes a line and publishes; the first changes the same line, sees the not-published mark, is told to fetch before pushing, fetches into a conflict, is stopped from committing with markers left, resolves it, and both end with the same file.
  - User settings pages, and no sideways overflow at 360 px on seven screens.

## Budgets

Compressed script, style and markup: 136 KB gzip in 34 files (limit 300 KB). Speed was not measured in this phase.

## Side by side

40 captures at 1280 by 800 and 390 by 844, light and dark, are kept outside the repository. There is no reference capture for any settings screen, because all of them need sign-in on GitHub and Gitea.

| Difference from GitHub | Intended |
|---|---|
| A collaborator is added by pasting a 64-character sign-in key, not by searching for a name | No. There is no directory of people to search. |
| The description and default branch are kept in this browser only; a collaborator does not receive them | No. They are not yet signed operations. |
| Rename and delete act on this browser's copy only, and say so | Yes. Nothing can reach copies others hold. |
| A rule names one branch exactly; no patterns | No. The model protects named branches. |
| Storage keys are kept only until the tab closes | Yes, by design. |
| The repository's settings have no Tags, Webhooks, Deploy keys or Actions pages | See "Stopped" and "Not built". |

## Stopped: organisations and teams

The prompt asks for organisations with people, teams and settings, and `docs/PARITY.md` lists "Organisations, teams, per-unit permissions" as full, "ported into the kernel".
That port has not happened. The proved model knows an owner, read and write access, a chain of up to five links, and protected branches. It has no organisation, no team, and no per-unit permission.

The prompt also says: "The rules stay in the proved model. The interface asks and shows; it never decides who may do what. No permission check is written in page code."
A team is a rule about who may do what. Building team screens now would mean either writing those rules in page code, which the prompt forbids, or shipping screens that manage teams which grant nothing, which the prompt also forbids ("do not ship a hollow version").

So this is a stop, as the prompt asks: organisations and teams need the model extended and proved first. That is work in `src/` (LexLean) with its own build and proofs, not interface work. Until then their entry points are absent: no New organisation in the create menu, no Organisations in Explore or in user settings.

## Not built

- **Tag protection, webhooks, Actions settings**: the product has no protected tags, no webhooks, and no runners, secrets or variables to configure. Actions belong to Phase 8.
- **Deploy keys and access tokens** as their own pages. A collaborator with a role and an expiration is the same thing here, and is offered once, under Collaborators.
- **Transfer, visibility, archive**: no owner to transfer to, no private repositories, no archived state.
- **Account**: no way to sign out of this browser or delete the sign-in key from the page.
- **Keys for verifying commits**: commits are not shown as Verified yet (Phase 2 report).
- **Sessions on other devices**: each device is its own key; there is no list of them.

## Not verified

- The storage-key form against a store that demands keys. The tests' store asks for none; the path that signs requests is covered by the older `test/s3.test.mjs`, which is skipped without credentials.
- The "protect from automatic clearing" request: the test confirms the browser answers, not that data then survives.
- Speed on the phone profile; accessibility audit; screen reader; any browser but Chromium; the first-time-user script walked by a person.
