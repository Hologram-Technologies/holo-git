# Parity with Gitea

Proposed for approval. Source paths are in the Gitea study at `eaa4fe91`.
Full means same behaviour. Adapted means same purpose, different mechanism, stated. Non-goal means absent, with the reason.
Release is the phase in `prompt.md` where it lands.

## Code

| Feature | Status | How, or why not | Release |
|---|---|---|---|
| Browse tree, file view, raw download | full | read objects locally | 2 |
| Commit list, commit view, graph | full | | 2 |
| Diff and compare | full | engine; result cached by tree pair | 2 |
| Blame | full | engine; result cached by commit and path | 2 |
| Branches and tags: list, create, delete, rename | full | signed ref updates, kernel-checked | 3 |
| Web editor, upload, apply patch, cherry-pick | full | commit built in the browser | 3 |
| Archive download | adapted | built in the browser, cached by tree | 5 |
| Clone and push over HTTP from a terminal | adapted | against a kappa peer, not the page | 3 |
| Git over SSH | non-goal | needs a daemon | |
| Fork | full | new refs over shared objects, no copy | 3 |
| Create, template, generate | full | | 3 |
| Import from GitHub, GitLab, Gitea | adapted | through their APIs where cross-origin rules allow; otherwise terminal push | 6 |
| Pull and push mirrors | adapted | a mirror is a replica; scheduled pulls need an open tab or an executor | 6 |
| Transfer, rename, redirect | adapted | signed operations; names resolve through the owner's log | 5 |
| Stars, watch, topics | adapted | signed operations; counts are per-replica and approximate | 5 |
| Search in a repository | adapted | index built in the browser, cached by tree, shareable | 5 |
| Explore across repositories | adapted | only what known replicas list; no global index | 6 |
| Large files | adapted | chunked storage built by us; LFS pointers honoured | 6 |
| Signed commit verification | full | verified in the browser | 2 |
| Server-side merge commit signing | adapted | the merging person's key signs | 4 |
| Custom server-side git hooks | non-goal | no server to run them; checks replace them | |

## Issues

| Feature | Status | How, or why not | Release |
|---|---|---|---|
| List, view, create, edit, close | full | signed operations | 4 |
| Numbering `#123` | adapted | assigned on sync by the home replica's ordered log; provisional identifier offline | 4 |
| Comments, timeline, edit history | full | history is intrinsic | 4 |
| Labels, milestones, assignees, reactions | full | | 4 |
| Dependencies, pin, lock, templates | full | | 4 |
| Cross-references and closing keywords | full | | 4 |
| Attachments | full | addressed blobs | 4 |
| Time tracking and stopwatch | full | | 5 |
| Issue search | adapted | local index | 5 |

## Pull requests

| Feature | Status | How, or why not | Release |
|---|---|---|---|
| Create, view, files, commits | full | | 4 |
| Review: approve, reject, comment, request, dismiss | full | signed, bound to the diff address | 4 |
| Mergeability and conflicts | full | engine three-way merge, cached by base, ours, theirs | 4 |
| Merge, squash, rebase, fast-forward | full | performed in the browser, then a signed ref update | 4 |
| Update branch | full | | 4 |
| Auto-merge | adapted | any client holding merge rights completes it when the kernel says mergeable | 4 |
| Branch protection | adapted | every reader enforces it; a violating ref update is ignored | 3 |
| Required approvals, stale handling | adapted | approval valid only for its diff address | 4 |
| Required status checks | adapted | satisfied by a trusted attestation for the tree | 4 |
| Protected tags, CODEOWNERS | full | | 4 |
| Stacked changes | added | not in Gitea; first class here | 4 |
| AGit flow | non-goal | needs a receive hook | |

## Collaboration

| Feature | Status | How, or why not | Release |
|---|---|---|---|
| Wiki | full | a git repository | 5 |
| Releases, assets, notes | full | | 5 |
| Projects and boards | full | | 5 |
| Project automation | adapted | applied by any client on sync | 5 |
| Activity, pulse, contributor charts | adapted | computed locally, cached by head | 5 |
| Dashboard feed and heatmap | adapted | from repositories held locally | 5 |
| Notifications inbox | adapted | derived from logs on sync | 5 |
| Email notifications, reply by mail | non-goal | needs a mail server | |
| Webhooks | adapted | emitted by an executor a user runs; none from the page | 6 |
| Feeds | adapted | generated on publish to a static replica | 6 |
| Live updates | adapted | on sync; push between tabs | 5 |
| Markdown, diagrams, math, highlighting | full | rendered in a sandbox | 2 |
| Themes | full | | 5 |
| Languages | adapted | English first; one string file makes others possible | 5 |

## Identity and access

| Feature | Status | How, or why not | Release |
|---|---|---|---|
| Profiles, follow | adapted | a profile is a signed document under an anchor | 5 |
| Sign-in | adapted | passkeys only; no passwords | 1 |
| External sign-in: LDAP, OAuth, PAM | non-goal | server-side by nature | |
| OAuth provider | non-goal | needs a token issuer | |
| Access tokens and scopes | adapted | scoped, time-limited delegations | 1 |
| Sign-in over SSH | non-goal | tied to SSH | |
| Deploy keys | adapted | a key with read or write access to one repository, held in the access list | 1 |
| SSH keys for verifying commits | adapted | kept for verifying commits, as GPG keys are | 2 |
| GPG keys | adapted | kept for verifying commits | 2 |
| Organisations, teams, per-unit permissions | full | Gitea's resolution order, ported into the kernel | 1 |
| Collaborators | full | | 1 |
| Private repositories | adapted | client-side encryption; revocation is forward-only | 6 |
| Anonymous and public per-unit access | adapted | read access is who holds the key | 6 |
| Blocking users | adapted | their operations are ignored by those who block | 5 |
| Audit log | adapted | the operation log is the audit log; it records repository operations, not sign-ins or settings changes | 1 |
| Admin panel | non-goal | no instance to administer | |

## Automation and packages

| Feature | Status | How, or why not | Release |
|---|---|---|---|
| Checks on push and pull request | adapted | run in the browser as WASM, reused by action key | 6 |
| Workflow files in GitHub Actions syntax | adapted | parsed for steps and inputs; container steps need an executor | 6 |
| Runners | adapted | any tab or contributor machine; no pool | 6 |
| Logs and artifacts | adapted | addressed blobs; failures as structured records | 6 |
| Secrets and variables | adapted | released to named executors by delegation | 6 |
| Scheduled workflows | adapted | need an open tab or an executor | 6 |
| Container and generic packages | adapted | kappa peers already speak these | 6 |
| The other 22 package formats | non-goal | each is its own protocol endpoint; one that is wanted becomes its own adapted row | |
| REST API in Gitea's shape | adapted | answered by the service worker for the page and local tools; remote callers need a peer | 5 |
| Agent interface | added | typed API and MCP server with the same rules | 5 |
| Federation endpoints | non-goal | replaced by replication | |

## Summary

Counted 2026-11-14, with the rows of the re-verification section below: 125 rows. Full: 43. Adapted: 64. Non-goal (cannot exist without a server): 16. Added: 2.
"Feature complete" as written cannot include the non-goals without a server. I recommend defining it as every row above delivered at its stated status.

## Re-verification, 2026-11-14

Phase 0 of `docs/PROMPT-UI.md`.
**Approved by the user on 2026-11-14:** all 42 added rows, including the six that cannot exist, and the four status changes. The four changes are now applied in the tables above; the words "proposed" and "not applied" below record how the section was written.
Checked against go-gitea/gitea at `eaa4fe918d6f296d4280f5f571686eb9f00a8bd8` (the commit `STUDY.md` used; committed 2026-11-13).
Read in full: `routers/web/web.go` (1,795 lines, 651 route registrations) and `models/unit/unit.go`. Read by listing: `templates/` (593 files) and the template names declared in `routers/web/`.
`options/locale/locale_en-US.ini` does not exist at this commit; the strings are in `options/locale/locale_en-US.json` (4,053 keys). It was used to confirm names, not walked key by key.

Statuses below use the prompt's three words: full, adapted, cannot exist (without a server). "Non-goal" above means the same as "cannot exist".
Every status in this section is a proposal. The six marked **cannot exist** need approval before Phase 1, as the prompt requires.

### Repository units

`models/unit/unit.go` defines ten: Code, Issues, Pull requests, Releases, Wiki, External wiki, External tracker, Projects, Packages, Actions.
Eight are covered above. Two were missing:

| Feature | Proposed status | How, or why not | Gitea source |
|---|---|---|---|
| External tracker (the Issues tab links to another site) | full | a stored address and number format; the tab becomes a link | `unit.go` `TypeExternalTracker` |
| External wiki (the Wiki tab links to another site) | full | a stored address | `unit.go` `TypeExternalWiki` |

### Rows added

| Area | Feature | Proposed status | How, or why not | Gitea route |
|---|---|---|---|---|
| Global | Installation page | adapted | first run replaces it: name, sign-in key, create or open a repository | `/install` (`templates/install.tmpl`) |
| Global | Issues and pull requests across repositories | adapted | from repositories held in this browser | `/issues`, `/pulls` |
| Global | Milestones across repositories | adapted | same | `/milestones` |
| Global | Code search across repositories, per owner and in Explore | adapted | local index over repositories held here | `/explore/code`, `/{username}/-/code` |
| Global | API documentation page | full | a static page over the same description | `/swagger.v1.json`, `/openapi3.v1.json` |
| Global | Sitemap | adapted | written on publish, like feeds | `/sitemap.xml`, `/explore/repos/sitemap-{idx}.xml` |
| Global | Instance banner dismissed by each user | **cannot exist** | set by an instance administrator; there is no instance | `/-/web-banner/dismiss` |
| Identity | Registration | adapted | first run; no form, no password | `/user/sign_up` |
| Identity | Email activation, forgotten password, forced password change | **cannot exist** | no passwords and no mail server | `/user/activate`, `/user/forgot_password`, `/user/recover_account`, `/user/settings/change_password` |
| Identity | Two-factor codes and scratch codes | **cannot exist** | a second factor guards a password; sign-in keys are the only factor | `/user/two_factor`, `/user/settings/security/two_factor/*` |
| Identity | Managing sign-in keys (add, rename, remove) | adapted | Gitea's passkey list, over this product's keys | `/user/settings/security/webauthn/*` |
| Identity | Account: email addresses, delete account | adapted | emails are profile fields used for commits, unverified; deleting removes keys and local data, not copies others hold | `/user/settings/account/*` |
| Identity | Avatars | adapted | an image in the signed profile; lookups by email hash at another service are out (no third-party requests) | `/user/settings/avatar`, `/avatar/{hash}`, `/{username}.png` |
| Identity | Public key lists at a guessable address | adapted | written on publish | `/{username}.keys`, `/{username}.gpg` |
| Identity | Settings lists: my organisations, my repositories | full | | `/user/settings/organization`, `/user/settings/repos` |
| Identity | Badges on profiles | **cannot exist** | assigned by an instance administrator | `/-/admin/badges/*` |
| Organisation | Organisation labels | full | signed operations at the owner | `/org/{org}/settings/labels` |
| Organisation | Team invitation by email | **cannot exist** | needs mail; an invitation link carried by any channel is the adapted form and belongs to the Teams row | `/org/invite/{token}` |
| Organisation | Work time report | adapted | computed locally from time tracking | `/org/{org}/worktime` |
| Organisation | Rename, delete, change visibility | adapted | signed operations; copies others hold persist | `/org/{org}/settings/rename`, `/delete`, `/visibility` |
| Organisation | Owner-level projects | full | same board, owned by a user or organisation | `/{username}/-/projects/*` |
| Repository | General settings: description, default branch, enabled units, avatar, template flag, merge options | full | signed operations | `/{owner}/{repo}/settings`, `/settings/branches/` |
| Repository | Archive, delete, change visibility, delete wiki | adapted | signed operations; delete cannot reach copies others hold | `/{owner}/{repo}/settings` (danger zone) |
| Repository | Patch and diff downloads for a commit or pull request | full | built in the browser | `/commit/{sha}.patch`, `.diff`, `/pulls/{index}.patch`, `.diff` |
| Repository | Sync a fork with its upstream | full | | `/branches/merge-upstream` |
| Repository | Restore a deleted branch | full | the history of ref updates is kept | `/branches/restore` |
| Repository | Cite this repository | full | read from `CITATION.cff` | `templates/repo/cite/` |
| Repository | LFS file locks | adapted | advisory, as signed operations; nothing can refuse a push at the storage | `/settings/lfs/locks` |
| Repository | Package clean-up rules | adapted | applied by any client with write access on sync | `/settings/packages/rules/*` (user and organisation) |
| Issues | Due date, time estimate, subscribe to one issue | full | | `/{type}/{index}/deadline`, `/time_estimate`, `/watch` |
| Pull requests | Line comments, suggestions, resolve a conversation, viewed-file marks, outdated comments | full | signed, bound to the diff address | `/pulls/{index}/files/reviews/*`, `/issues/resolve_conversation`, `/viewed-files` |
| Pull requests | Change target branch, delete branch after merge | full | | `/pull/{index}/target_branch`, `/pulls/{index}/cleanup` |
| Pull requests | Allow edits from maintainers | adapted | a time-limited write permission on the head branch | `/pulls/{index}/set_allow_maintainer_edit` |
| Automation | Run a workflow by hand, with inputs | adapted | runs in the tab or on a machine the user runs | `/actions/run`, `/actions/workflow-dispatch-inputs` |
| Automation | Re-run, re-run failed, cancel, delete a run; disable a workflow | adapted | same | `/actions/runs/{run}/rerun`, `/rerun-failed`, `/cancel`, `/delete`, `/actions/disable` |
| Automation | Approve runs from forks | adapted | each runner owner decides what they run; there is no shared pool to protect | `/actions/approve-all-checks`, `/actions/runs/{run}/approve` |
| Automation | Workflows required across an owner's repositories | adapted | a rule in the owner's log, applied by every reader | `/settings/actions/scoped-workflows` (user, organisation) |
| Automation | Job queue view | **cannot exist** | there is no queue | `/actions/job_queue` |
| Automation | Workflow status badge image | adapted | written on publish | `/actions/workflows/{name}/badge.svg` |
| Automation | Artifact preview | adapted | rendered in a sandbox from stored files | `/actions/artifacts/{id}/preview` |

42 rows added: these 40 and the two units. Proposed: 14 full, 22 adapted, 6 cannot exist.

Routes that add no row because an existing row covers them: OAuth application and authorisation screens (OAuth provider); linked accounts (External sign-in); everything under `/-/admin` except badges (Admin panel); git hook editing (Custom server-side git hooks); deploy keys (SSH and deploy keys); `.well-known` federation and OpenID documents (Federation, OAuth provider); notification email settings (Email notifications); Cargo index and Chef key pair (the other package formats); migration status, retry and cancel (Import); stars, watchers and forks lists (Stars, watch, topics); `/devtest` (development only).

### Existing rows proposed for a status change

Not applied. Each needs a decision.

| Row | Now | Proposed | Reason |
|---|---|---|---|
| SSH and deploy keys | non-goal | split in three: SSH sign-in stays cannot exist; **deploy keys become adapted**; **SSH keys for verifying commits become adapted** | A deploy key is a key with read or write access to one repository. That is what the access list already holds (`web/identity.js`, `grant`). Gitea verifies SSH-signed commits, and the prompt lists "Keys (commit-verification keys)" and "Deploy keys only if they can exist" in Settings. |
| Audit log | full | adapted | Gitea's audit log (`/user/settings/audit_logs`, and the organisation, repository and admin ones) also records sign-ins and settings changes. The operation log records repository operations only. |
| Themes and languages | full | themes full; **languages adapted** | Gitea ships many locales. The prompt asks for one string file reviewed as a whole and no translations. "Full" would mean translating every new string. |
| The other 22 package formats | non-goal for now | cannot exist | "For now" is not one of the three statuses. Each format needs an endpoint a command-line client talks to. If one is wanted, it should be its own adapted row. |

### Wording that is out of date, status unchanged

- "Checks on push and pull request: run in the browser as WASM". `ROADMAP.md` records that the runner is a command on a contributor's machine, because a browser cannot run a compiler. Status stays adapted.
- "Sign-in: passkeys only". `README.md` records that the only identity today is a key generated in the browser, not bound to a passkey. Status stays adapted; the mechanism is not built.
- The Release column counts the phases of `docs/PROMPT.md`. `docs/PROMPT-UI.md` has its own ten phases. A column for the interface phase would remove the ambiguity; not added here.

### Counts

Before the approved changes were applied, the table above this section held 80 rows: 30 full, 38 adapted, 9 non-goal, 1 non-goal for now, 2 added. Its summary says "about 45" full and 11 non-goals.
`docs/PROMPT-UI.md` says "the eleven such features". The table lists ten.
With every proposal in this section accepted there would be 125 rows (two existing rows split): 43 full, 64 adapted, 16 cannot exist, 2 added. The "What is different" page would then name sixteen things, not eleven.
