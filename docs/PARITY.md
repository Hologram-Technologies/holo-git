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
| Themes and languages | full | | 5 |

## Identity and access

| Feature | Status | How, or why not | Release |
|---|---|---|---|
| Profiles, follow | adapted | a profile is a signed document under an anchor | 5 |
| Sign-in | adapted | passkeys only; no passwords | 1 |
| External sign-in: LDAP, OAuth, PAM | non-goal | server-side by nature | |
| OAuth provider | non-goal | needs a token issuer | |
| Access tokens and scopes | adapted | scoped, time-limited delegations | 1 |
| SSH and deploy keys | non-goal | tied to SSH | |
| GPG keys | adapted | kept for verifying commits | 2 |
| Organisations, teams, per-unit permissions | full | Gitea's resolution order, ported into the kernel | 1 |
| Collaborators | full | | 1 |
| Private repositories | adapted | client-side encryption; revocation is forward-only | 6 |
| Anonymous and public per-unit access | adapted | read access is who holds the key | 6 |
| Blocking users | adapted | their operations are ignored by those who block | 5 |
| Audit log | full | the operation log is the audit log | 1 |
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
| The other 22 package formats | non-goal for now | each is its own protocol endpoint; revisit by demand | |
| REST API in Gitea's shape | adapted | answered by the service worker for the page and local tools; remote callers need a peer | 5 |
| Agent interface | added | typed API and MCP server with the same rules | 5 |
| Federation endpoints | non-goal | replaced by replication | |

## Summary

Full: about 45 rows. Adapted: about 40. Non-goal: 11. Added: 2.
"Feature complete" as written cannot include the non-goals without a server. I recommend defining it as every row above delivered at its stated status.
