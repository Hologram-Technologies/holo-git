# Prompt: make holo-git feature complete and familiar

You are continuing work on holo-git, a git host that runs entirely in the browser, in the repository `Hologram-Technologies/holo-git`. The engine, the signed log, protected branches, thin pull requests, content-keyed checks and a shared result store exist. The page that shows them is about 600 lines and shows a fraction of what a git host shows. Your job is to close that gap.

Read `docs/PROMPT.md`, `docs/PARITY.md`, `docs/STUDY.md`, `docs/ROADMAP.md`, `docs/THREAT-MODEL.md` and `README.md` before anything else. They are the record of what was decided and why. Do not re-decide them.

## The goal, in one sentence

Someone who has used GitHub or Gitea opens holo-git and can do everything they expect, find it where they expect, and never meet a word they have to look up.

## Three rules that settle most questions

1. **Gitea decides what exists. GitHub decides how it looks.** Gitea's feature set and page structure are the checklist. GitHub's visual language (spacing, type, colour, components, icons) is the style. Where the two differ in layout, follow GitHub; Gitea's own layout follows GitHub's closely already.
2. **No server, ever.** Nothing may require a process the project runs. Storage the user names, a machine the user runs, and the user's browser are the only places work happens.
3. **The interface speaks git-host, not implementation.** If a word would not appear on github.com, it does not appear here.

## What "feature complete" means here

Every row of `docs/PARITY.md`, delivered at its stated status. There are three statuses and each has a required appearance:

- **Full.** Works as in Gitea.
- **Adapted.** Same purpose, different mechanism. The screen looks and behaves like Gitea's. The difference is stated once, in plain words, where the user would otherwise be surprised, and nowhere else.
- **Cannot exist without a server.** The entry point is absent, not disabled. Do not show a tab that leads to an apology. The eleven such features are listed in `docs/PARITY.md`; add a short "What is different" page under Help that names them and the reason for each.

Before building, re-verify `docs/PARITY.md` against Gitea at a pinned commit. Walk `routers/web/web.go`, `templates/`, `options/locale/locale_en-US.ini` and `models/unit/unit.go`. Any route or repository unit not in the parity table is a gap in the table: add the row, propose a status, and stop for approval if the status is "cannot exist".

## Study before building

Produce `docs/UI-STUDY.md`. It is short and it is evidence, not opinion.

1. **Screen inventory.** Every distinct screen in Gitea, by route, grouped as: global, user, organisation, repository, settings. For each: its purpose in one line, the Gitea template that renders it, and the GitHub screen it corresponds to.
2. **Reference captures.** For each screen, a capture of Gitea (a public demo instance or a local one you start and stop) and of the corresponding public GitHub page, at 1280 by 800 and at 390 by 844, light and dark. Store them outside the repository; record how to reproduce them.
3. **Component inventory.** The repeated parts: header, repository header with tabs, file table, commit row, diff view, timeline item, comment box, label, state badge, button kinds, dropdown, dialog, tab bar, pagination, empty state, flash message, avatar, heatmap, counter. For each, the measurements that matter: height, padding, radius, border, type size and weight.
4. **Interaction inventory.** Keyboard shortcuts, the file finder, permalinks, line selection, the command palette, how forms report errors, what is optimistic.

Do not copy template or stylesheet text from Gitea or GitHub. Measure and rebuild.

## Visual language

Use GitHub's published design system, which is open source under the MIT licence: Primer's design tokens (`@primer/primitives`) for colour, space, type and radius, and Octicons for icons. Pin exact versions. Take values from the packages; never type a colour by hand.

- **Type.** GitHub's system font stack for text and its monospace stack for code. No web fonts are downloaded.
- **Colour.** Primer's light and dark themes, following the system setting, with a switch in Settings → Appearance. Add the dimmed and high-contrast themes if they come free with the tokens.
- **Density.** Match GitHub's: 14 px body text, 32 px default controls, 6 px radius, 1 px borders. Check against the captures, not against this sentence.
- **State colours.** Open, closed, merged, draft; added and removed lines; success, failure, pending. Use Primer's roles for each.
- **Icons.** Octicons only, inlined as SVG. One meaning per icon, the same meaning GitHub gives it.

Not to be used: GitHub's name, logo, mascot or any other mark, and Gitea's. The product has its own name and a plain mark. A page that could be mistaken for github.com itself is a defect.

The whole page stays one pinned, offline-capable bundle. Keep the existing integrity manifest. Budget: under 300 KB of script and style compressed, excluding the two WebAssembly files; first paint of a cached repository under 200 ms; any navigation within a loaded repository under 100 ms. Measure on a mid-range phone profile and report the numbers.

## Structure

Addresses follow GitHub's, so links are guessable. Use hash-free paths with the service worker answering navigation.

**Global**
- `/` : signed out, a short landing page with one action; signed in, the dashboard.
- Dashboard: activity feed on the left; on the right the contribution heatmap and the repository list with its filter box and tabs (all, sources, forks, mirrors, collaborative), as in Gitea.
- `/explore/repos`, `/explore/users`, `/explore/organizations`: what the storage locations this browser knows can list. Say so once, in the empty state.
- `/issues`, `/pulls`: across repositories, with the assigned, created, mentioned and review-requested filters.
- `/notifications`, `/search`, `/new`, `/new/import`, `/organizations/new`.
- Header: mark, search box with `/` to focus, Issues, Pull requests, Explore, notification bell, plus menu, avatar menu.

**Repository** `/{owner}/{repo}`
- Header: owner / name, visibility badge, Watch, Fork, Star with counts.
- Tabs, in this order, each hidden when its unit is off: Code, Issues, Pull requests, Actions, Packages, Projects, Releases, Wiki, Activity, Settings.
- Code: branch and tag switcher, file finder (`t`), Add file, the green Code button with clone addresses and archive download, latest-commit bar, file table with last commit per row, rendered README, the sidebar (about, topics, releases, languages bar).
- `/tree/{ref}/{path}`, `/blob/{ref}/{path}` with line numbers, line and range selection in the address, Raw, Blame, History, Edit, Delete, permalink (`y`).
- `/commits/{ref}`, `/commit/{sha}` with unified and split diff, file tree, per-file collapse, whitespace toggle.
- `/compare/{base}...{head}`, `/branches`, `/tags`, `/blame/...`, `/find/{ref}`, `/search`.
- Issues: list with open and closed counts, filters for label, milestone, assignee, author, sort; search box with GitHub's qualifier syntax. Issue page: title, state badge, timeline, comment box with Write and Preview, the right sidebar (assignees, labels, projects, milestone, due date, time tracking, dependencies, participants, lock, pin). `/labels`, `/milestones`.
- Pull requests: the same list. Pull request page with Conversation, Commits, Checks, Files changed. Review: comment on a line or range, suggest a change, start and submit a review (comment, approve, request changes), resolve a conversation, viewed-file ticks. The merge box at the foot of the conversation: required reviews, required checks with each check's state, conflicts with the resolution editor, the merge button with its method menu, update branch, delete branch after merge.
- Actions: runs list filtered by workflow, branch, status, actor; run page with jobs on the left and a step log on the right. It shows the checks that exist today.
- Releases, tags, Wiki (pages, history, edit), Projects (board with columns, drag and drop), Packages.
- Activity: pulse, contributors, code frequency, recent commits. Computed in the browser from the repository.
- Settings: General, Collaborators, Branches (protection rules), Tags, Webhooks, Deploy keys only if they can exist, Actions (runners, secrets, variables), Danger zone (rename, transfer, visibility, archive, delete) with type-the-name confirmation.

**User and organisation**
- `/{user}`: avatar, name, bio, follow, heatmap, tabs for Overview, Repositories, Projects, Packages, Stars.
- `/{org}`: repositories, people, teams, settings.
- `/user/settings`: Profile, Account, Appearance, Security (sign-in keys, sessions on other devices), Applications (access tokens), Keys (commit-verification keys), Organisations, Repositories, Storage.

**First run replaces installation.** Gitea has an install page because it has a server. Here, opening the address is the installation. The first-run flow is three steps at most: choose a name, create a sign-in key, and either create a repository or open one by address. Where data is kept is asked only when the user first publishes something, with sensible wording ("Where should this repository be stored?") and one recommended choice.

## Words

Build a single file of every string the interface shows. Review it as a whole. A reviewer who has only ever used GitHub must understand every line.

Never shown to a user, anywhere, including errors, tooltips and settings: Prism, UOR, kappa, holo, LexLean, kernel, engine, fold, record, signed log, replica, action key, digest, label in the content-address sense, attestation, delegation, grant, closure, manifest, wasm.

Say instead:

| Implementation | The interface says |
|---|---|
| replica, object store | remote, or storage |
| push to a replica | Push, or Publish |
| device key | sign-in key, or "this browser" |
| grant, delegation | collaborator, or access token |
| revoke | Remove |
| protect record | branch protection rule |
| check record, action key | check, status |
| reused result | "Passed (already checked)" |
| the kernel refused it | the plain reason: "This branch is protected. Open a pull request." |
| signed and verified | the Verified badge, as on GitHub |
| the log is invalid | "This repository's history has been tampered with", then what to do |

Trust details exist, because they are the product's point, but in one place: clicking a Verified badge, and an About dialog reached from the footer, which holds the page's integrity value. Not in the header, not in lists, not in empty states.

Writing rules: sentence case; verbs on buttons; no exclamation marks; no explaining how it works unless the user asked; errors say what happened and what to do next; an empty state has one line and one action. If removing a piece of text loses nothing, remove it.

## Behaviour that makes it feel right

- Every action responds at once. Local first, then publish; show a small unsynced marker, never a blocking spinner.
- Back, forward, reload and deep links work on every screen. Scroll position is restored.
- GitHub's keyboard shortcuts, with the `?` help dialog: `/`, `t`, `y`, `l`, `b`, `w`, `g c`, `g i`, `g p`, `.`, `c`, `e`, `j` and `k` in lists, `Ctrl+Enter` to submit, `Ctrl+K` for the command palette.
- Markdown as GitHub renders it: tables, task lists, mentions, issue references, emoji codes, footnotes, alerts, code highlighting, diagrams and math, in a sandbox.
- Works from 360 px wide. Works with a keyboard alone and with a screen reader; meet WCAG 2.2 AA. Respect reduced motion.
- Works offline for everything that does not need another machine, and says "Offline" quietly in one place.

## What must not change

- The rules stay in the proved model. The interface asks and shows; it never decides who may do what. No permission check is written in page code.
- No new trust. Anything the page displays about another person's action was verified first.
- No telemetry, no third-party requests, no fonts or scripts from another origin.
- Checks stay defined in `.holo/checks.json`; every new part of the page is covered by a check with honest inputs.

## How to work

Phases, each ending in a gate: stop, show the result, wait for approval.

0. **Study.** `docs/UI-STUDY.md`, the re-verified parity table, the string map. No product code.
1. **Foundation.** Tokens, icons, the component set from the inventory, the router, the header and footer, themes, the first-run flow. A component gallery page for review.
2. **Code.** Everything under the Code tab, on the existing engine.
3. **Issues.** Lists, issue page, labels, milestones, the cross-repository list.
4. **Pull requests.** Review on lines, the merge box, conflict resolution in place, checks tab.
5. **Home.** Dashboard, heatmap, profile, explore, notifications, search, command palette.
6. **Settings and people.** Repository, user and organisation settings; teams.
7. **Around the code.** Releases, wiki, projects, activity.
8. **Automation.** Actions screens over the checks; packages.
9. **Finish.** Accessibility audit, performance budget, the string review, the "What is different" page.

At every gate:

- **Side by side.** For each screen in the phase, your capture beside the two reference captures, at both widths and both themes. List every visible difference and say whether it is intended.
- **Tests.** Each screen has a test that drives it in a real browser engine through its main path and through one failure. The existing 92 tests keep passing.
- **A first-time user script.** Ten tasks a GitHub user would attempt (find a file, comment on a line, merge a pull request, protect a branch and so on), walked with no help text, noting every hesitation. A hesitation is a defect.
- **The banned-word scan** over every string the build can show. It runs as a check and fails the build.
- **Budgets** measured and reported, including when missed.

Report plainly. Say what is not done and what was not verified. Do not call a screen done because it renders. If a Gitea feature turns out not to fit a serverless design, stop and say so with the reason; do not ship a hollow version of it.

## Reference images supplied with this request

- **Gitea's dashboard, dark.** The target for the signed-in home: heatmap across the top, feed below, repository list with filter and tabs on the right.
- **A Gitea metrics dashboard.** The counts and time series belong on a repository's Activity tab and an organisation's overview, computed in the browser. There is no instance, so there is no instance-wide admin view.
- **A Gitea installation log.** The contrast to draw: none of this exists here. First run is the three steps above.
- **A 3D editor with docked panels.** Taken as a reference for a dense, panelled, professional tool, not for layout. Confirm or correct this reading before Phase 1.
