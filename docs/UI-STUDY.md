# Interface study

Phase 0 of `docs/PROMPT-UI.md`. Written 2026-11-14. Evidence, not opinion: every claim names its source. No product code was changed.
Companion documents: `docs/PARITY.md` (section "Re-verification") and `docs/UI-STRINGS.md`.

## Sources

| Source | Pinned at | How it was read |
|---|---|---|
| go-gitea/gitea | commit `eaa4fe918d6f296d4280f5f571686eb9f00a8bd8`, committed 2026-11-13; the commit `docs/STUDY.md` used | `routers/web/web.go` and `models/unit/unit.go` in full; template names from the constants in `routers/web/**`; `templates/` by listing (593 files); `web_src/js/modules/shortcut.ts` and `web_src/js/features/repo-code.ts` for interaction; `package.json` for versions |
| `@primer/primitives` | 11.10.0 from the npm registry; tarball SHA-256 `99f4ebd9b6ef21ce06ac8081ed0456cc7bea016c268f0cfc6898dda895cab4a9`; MIT | custom properties read by script from `dist/css/**`; nothing typed by hand |
| `@primer/octicons` | 19.42.0 from the npm registry; tarball SHA-256 `8ae65252de0d8b24e068362c375533ef9a00fdf04e99f23d80df680d34138237`; MIT. Gitea pins the same version (`package.json` at the commit above) | file names in `build/svg/` |
| GitHub's shortcut documentation | `https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts` and `.../github-command-palette`, read 2026-11-14; not versioned | tables parsed by script |
| github.com, signed out | pages listed under Reference captures, 2026-11-14 | captured and measured in a headless browser |
| A local Gitea | official image `docker.gitea.com/gitea@sha256:73e9ae15d01f6f2089de8046d49211fb9620cdb65927e0619042e040502b7ccf`, which reports version `29.0.0+dev-404-ge2f451ae11` | captured, signed out |

The local Gitea is one day of commits newer than the pinned source commit (`e2f451ae11` against `eaa4fe91`). No image is published for the exact commit. Routes and templates in this document come from the pinned source; only the pictures come from the image.

## 1. Screen inventory

One row per distinct screen: a route that renders its own page. Routes that only post a form, return data to a page, or redirect are not screens.
"Template" is the path under `templates/` without `.tmpl`, as declared in `routers/web/` at the pinned commit.
"GitHub screen" is the path on github.com that serves the same purpose; "none" means GitHub has no such page.
"Capture" is the identifier used under Reference captures, or the reason there is none: **sign-in** (the screen needs an account, and this study did not sign in anywhere), **state** (it needs data or a condition the seeded sample lacks), **in-page** (not a separate page).

### Global

| # | Route | Purpose | Template | GitHub screen | Capture |
|---|---|---|---|---|---|
| G1 | `/` signed out | Landing page | `home` | `/` signed out | landing |
| G2 | `/` signed in | Dashboard: activity feed, heatmap, repository list | `user/dashboard/dashboard` | `/` signed in | sign-in |
| G3 | `/explore/repos` | Browse and search repositories | `explore/repos` | `/search?type=repositories` | explore-repos |
| G4 | `/explore/users` | Browse and search users | `explore/users` | `/search?type=users` | explore-users |
| G5 | `/explore/organizations` | Browse and search organisations | `explore/users` | none (a user search filtered to organisations) | explore-orgs |
| G6 | `/explore/code` | Search code across repositories | `explore/code` | `/search?type=code` | sign-in on GitHub; not attempted on Gitea (needs an indexer) |
| G7 | `/issues` | My issues across repositories | `user/dashboard/issues` | `/issues` | sign-in |
| G8 | `/pulls` | My pull requests across repositories | `user/dashboard/issues` | `/pulls` | sign-in |
| G9 | `/milestones` | Milestones across repositories | `user/dashboard/milestones` | none | sign-in |
| G10 | `/notifications` | Notification inbox | `user/notification/notification` | `/notifications` | sign-in |
| G11 | `/notifications/subscriptions` | Issues and pull requests I am subscribed to | `user/notification/notification_subscriptions` | `/notifications/subscriptions` | sign-in |
| G12 | `/notifications/watching` | Repositories I watch | `user/notification/notification_subscriptions` | `/watching` | sign-in |
| G13 | `/repo/create` | New repository | `repo/create` | `/new` | sign-in |
| G14 | `/repo/migrate` | Import a repository, one form per source service | `repo/migrate/migrate` | `/new/import` | sign-in |
| G15 | `/org/create` | New organisation | `org/create` | `/organizations/new` (address as given in the prompt; not opened) | sign-in |
| G16 | `/user/login` | Sign in | `user/auth/signin` | `/login` | sign-in page itself: sign-in |
| G17 | `/user/sign_up` | Register | `user/auth/signup` | `/signup` | not attempted (registration disabled on the local instance) |
| G18 | `/user/forgot_password`, `/user/recover_account` | Reset a password by mail | `user/auth/forgot_passwd`, `user/auth/reset_passwd` | `/password_reset` | not attempted |
| G19 | `/user/activate` | Confirm an email address | `user/auth/activate`, `user/auth/activate_prompt` | email verification | state |
| G20 | `/user/two_factor`, `/user/two_factor/scratch` | Second-factor code at sign-in | `user/auth/twofa`, `user/auth/twofa_scratch` | `/sessions/two-factor` | sign-in |
| G21 | `/user/webauthn` | Security key at sign-in | `user/auth/webauthn` | passkey prompt on `/login` | sign-in |
| G22 | `/user/link_account` | Link an external account | `user/auth/link_account` | none | state |
| G23 | `/login/oauth/authorize` | Approve an application's access | `user/auth/grant`, `user/auth/grant_error` | `/login/oauth/authorize` | sign-in |
| G24 | `/user/settings/change_password` | Forced password change | `user/auth/change_passwd` | none | state |
| G25 | `/install` | First-time server set-up | `install`, `post-install` (served by `routers/install`, outside `web.go`) | none | state (the instance was started already installed) |
| G26 | any unknown address | Not found; also server error pages | `status/4xx`, `status/500`, `status/503` | the not-found page | not-found |
| G27 | `/api/swagger` | API documentation | `swagger/openapi-viewer` | `docs.github.com/rest` | not attempted |
| G28 | `/org/invite/{token}` | Accept a team invitation | `org/team/invite` | organisation invitation page | state |
| G29 | `/-/admin/**` | Instance administration: 23 menu entries, 31 templates under `admin/` plus `admin/audit/list` | see `templates/admin/navbar.tmpl` | none on github.com | sign-in; cannot exist here |

### User

| # | Route | Purpose | Template | GitHub screen | Capture |
|---|---|---|---|---|---|
| U1 | `/{username}` | Profile: avatar, bio, heatmap, profile README or repositories | `user/profile` | `/{username}` | profile |
| U2 | `/{username}?tab=activity` | Public activity feed | `user/profile` | the activity section of `/{username}` | not attempted |
| U3 | `/{username}?tab=repositories` | Repositories | `user/profile` | `/{username}?tab=repositories` | not attempted |
| U4 | `/{username}?tab=stars` | Starred repositories | `user/profile` | `/{username}?tab=stars` | not attempted |
| U5 | `/{username}?tab=watching` | Watched repositories | `user/profile` | `/watching` | not attempted |
| U6 | `/{username}?tab=followers`, `?tab=following` | People lists | `user/profile` | `/{username}?tab=followers` | not attempted |
| U7 | `/{username}/-/projects` | Owner-level project list | `org/projects/list` | `/users/{username}/projects` | not attempted |
| U8 | `/{username}/-/projects/{id}` | Project board | `org/projects/view` | a project board | state |
| U9 | `/{username}/-/projects/new`, `/{id}/edit` | New or edit project | `org/projects/new` | new project dialog | sign-in |
| U10 | `/{username}/-/projects/{id}/workflows` | Project automation rules | `org/projects/workflows` | project workflows | state |
| U11 | `/{username}/-/packages` | Package list | `user/overview/packages` | `/{username}?tab=packages` | packages |
| U12 | `/{username}/-/packages/{type}/{name}/{version}` | One package version | `package/view` | a package page | state |
| U13 | `/{username}/-/packages/{type}/{name}/versions` | All versions of a package | `user/overview/package_versions` | package versions | state |
| U14 | `/{username}/-/packages/settings/{type}/{name}` | Package settings | `package/settings` | package settings | sign-in |
| U15 | `/{username}/-/code` | Search code in one owner's repositories | `user/code` | `/search?type=code` with `user:` | not attempted |

### Organisation

Routes under `/{org}/-/` (projects, packages, code) are U7 to U15 with an organisation as owner.

| # | Route | Purpose | Template | GitHub screen | Capture |
|---|---|---|---|---|---|
| O1 | `/{org}` | Organisation home: profile README, repositories, members | `org/home` | `/{org}` | org-home |
| O2 | `/{org}/-/repositories` | Repository list, when the home shows a README | `org/home` | `/orgs/{org}/repositories` | not attempted |
| O3 | `/org/{org}/members` | Members | `org/member/members` | `/orgs/{org}/people` | not attempted |
| O4 | `/org/{org}/teams` | Teams | `org/team/teams` | `/orgs/{org}/teams` | sign-in |
| O5 | `/org/{org}/teams/{team}` | A team's members | `org/team/members` | `/orgs/{org}/teams/{team}` | sign-in |
| O6 | `/org/{org}/teams/{team}/repositories` | A team's repositories | `org/team/repositories` | `/orgs/{org}/teams/{team}/repositories` | sign-in |
| O7 | `/org/{org}/teams/new`, `/teams/{team}/edit` | New or edit team, with per-unit permissions | `org/team/new` | new team page | sign-in |
| O8 | `/org/{org}/dashboard`, `/dashboard/{team}` | Organisation dashboard | `user/dashboard/dashboard` | `/orgs/{org}/dashboard` | sign-in |
| O9 | `/org/{org}/issues`, `/pulls`, `/milestones` | Organisation-wide lists | `user/dashboard/issues`, `user/dashboard/milestones` | `/issues` filtered by organisation | sign-in |
| O10 | `/org/{org}/worktime` | Tracked time by repository, milestone or member | `org/worktime` | none | sign-in |

### Repository

All under `/{owner}/{repo}`. Gitea writes file addresses as `/src/{branch|tag|commit}/{name}/{path}` and redirects `/tree/*` and `/blob/*` to them (`web.go` lines 1720 to 1728). The prompt asks for GitHub's shorter form.

| # | Route | Purpose | Template | GitHub screen | Capture |
|---|---|---|---|---|---|
| R1 | `` (root) | Code tab: file table, latest commit, README, sidebar | `repo/home` | `/{o}/{r}` | repo-home |
| R2 | root, empty repository | Quick set-up instructions | `repo/empty` | the empty-repository page | state |
| R3 | root, during import | Import progress | `repo/migrate/migrating` | import progress | state |
| R4 | `/src/{ref}/{dir}` | Directory listing | `repo/view` with `repo/view_list` | `/tree/{ref}/{path}` | tree |
| R5 | `/src/{ref}/{file}` | File view: lines, raw, blame, history, edit, delete | `repo/view` with `repo/view_file` | `/blob/{ref}/{path}` | blob, blob-lines |
| R6 | `/blame/{ref}/{file}` | Blame | `repo/blame` | `/blame/{ref}/{path}` | blame |
| R7 | `/commits/{ref}` (also with a path) | Commit list, file history | `repo/commits` | `/commits/{ref}` | commits |
| R8 | `/graph` | Commit graph | `repo/graph` | `/network` | graph |
| R9 | `/commit/{sha}` | One commit: message, diff, file tree | `repo/commit_page` with `repo/diff/box` | `/commit/{sha}` | commit |
| R10 | `/compare/{base}...{head}` | Compare, and the new pull request form | `repo/diff/compare` | `/compare/{base}...{head}` | compare |
| R11 | `/branches` | Branch list: default, ahead and behind, create, delete, rename | `repo/branch/list` | `/branches` | branches |
| R12 | `/tags` | Tag list | `repo/tag/list` | `/tags` | tags |
| R13 | `/search` | Search code in the repository | `repo/search` | `/search?q=repo:...&type=code` | code-search |
| R14 | file finder on R1 and R4 | Find a file by name | in-page (`web_src/js/components/RepoFileSearch.vue`; data from `/tree-list/`) | the "Go to file" box | in-page |
| R15 | `/_edit/{branch}/{path}`, `/_new/{branch}/{path}` | Web editor with commit form | `repo/editor/edit` | `/edit/{ref}/{path}`, `/new/{ref}` | sign-in |
| R16 | `/_delete/{branch}/{path}` | Delete a file | `repo/editor/delete` | `/delete/{ref}/{path}` | sign-in |
| R17 | `/_upload/{branch}/{path}` | Upload files | `repo/editor/upload` | `/upload/{ref}` | sign-in |
| R18 | `/_diffpatch/{branch}` | Apply a patch | `repo/editor/patch` | none | sign-in |
| R19 | `/_cherrypick/{sha}/{branch}` | Cherry-pick or revert a commit | `repo/editor/cherry_pick` | none (Revert on a merged pull request) | sign-in |
| R20 | editor without write access | Offer to fork, then edit | `repo/editor/fork` | the fork notice in the editor | sign-in |
| R21 | `/fork` | Fork form | `repo/pulls/fork` | `/fork` | sign-in |
| R22 | `/forks` | Fork list | `repo/forks` | `/forks` | forks |
| R23 | `/stars`, `/watchers` | People lists | `repo/watchers` | `/stargazers`, `/watchers` | stars, watchers (Gitea only) |
| R24 | `/issues` | Issue list with filters | `repo/issue/list` | `/issues` | issues |
| R25 | `/issues/new` | New issue | `repo/issue/new` | `/issues/new` | sign-in |
| R26 | `/issues/new/choose` | Choose an issue template | `repo/issue/choose` | `/issues/new/choose` | sign-in |
| R27 | `/issues/{index}` | Issue: title, timeline, comment box, sidebar | `repo/issue/view` | `/issues/{n}` | issue |
| R28 | `/labels` | Labels | `repo/issue/labels` | `/labels` | labels |
| R29 | `/milestones` | Milestones | `repo/issue/milestones` | `/milestones` | milestones |
| R30 | `/milestones/new`, `/milestones/{id}/edit` | New or edit milestone | `repo/issue/milestone_new` | `/milestones/new` | sign-in |
| R31 | `/milestone/{id}` | Issues and pull requests in a milestone | `repo/issue/milestone_issues` | `/milestone/{n}` | milestone |
| R32 | `/pulls` | Pull request list | `repo/issue/list` | `/pulls` | pulls |
| R33 | `/pulls/{index}` | Conversation, with the merge box | `repo/issue/view`, `repo/issue/view_content/pull_merge_box` | `/pull/{n}` | pull-open, pull-merged |
| R34 | `/pulls/{index}/commits` | Commits tab | `repo/pulls/commits` | `/pull/{n}/commits` | pull-commits |
| R35 | `/pulls/{index}/files` (also one commit, or a range) | Files changed tab with review | `repo/pulls/files` | `/pull/{n}/files` | pull-files |
| R36 | `/actions` | Runs list, filtered by workflow, actor, status, branch | `repo/actions/list` | `/actions` | actions |
| R37 | `/actions/runs/{run}` (also `/jobs/{job}`, `/attempts/{n}`) | Run: jobs on the left, step log on the right | `repo/actions/view` | `/actions/runs/{id}` | actions-run (GitHub only; the sample has no runs) |
| R38 | `/actions/runs/{run}/workflow` | The workflow file of a run | `repo/actions/view` | the workflow-file tab of a run | state |
| R39 | `/actions/job_queue` | Jobs waiting for a runner | `repo/actions/job_queue`, `shared/actions/job_queue_list` | none | sign-in |
| R40 | `/actions/artifacts/{id}/preview` | Preview an artifact | `repo/actions/artifact_preview` | none | sign-in |
| R41 | `/packages` | Packages linked to the repository | `repo/packages` | the Packages sidebar section | not attempted |
| R42 | `/projects` | Project list | `repo/projects/list` | `/projects` | projects |
| R43 | `/projects/{id}` | Board with columns and cards | `repo/projects/view` | a project board | state (Gitea has no API to create a project; none was seeded) |
| R44 | `/projects/new`, `/projects/{id}/edit` | New or edit project | `repo/projects/new` | new project dialog | sign-in |
| R45 | `/projects/{id}/workflows` | Project automation rules | `repo/projects/workflows` | project workflows | state |
| R46 | `/releases` | Release list | `repo/release/list` | `/releases` | releases |
| R47 | `/releases/tag/{tag}` | One release | `repo/release/list` | `/releases/tag/{tag}` | release |
| R48 | `/releases/new`, `/releases/edit/{tag}` | New or edit release | `repo/release/new` | `/releases/new` | sign-in |
| R49 | `/wiki`, `/wiki/{page}` | Wiki page | `repo/wiki/view` | `/wiki`, `/wiki/{page}` | wiki |
| R50 | `/wiki`, no pages yet | Start the wiki | `repo/wiki/start` | the empty-wiki page | state |
| R51 | `/wiki/?action=_pages` | Page list | `repo/wiki/pages` | the Pages box on every wiki page | wiki-pages |
| R52 | `/wiki/{page}?action=_revision` | Page history | `repo/wiki/revision` | `/wiki/{page}/_history` | wiki-history |
| R53 | `/wiki/?action=_new`, `/wiki/{page}?action=_edit` | New or edit page | `repo/wiki/new` | `/wiki/_new`, `/wiki/{page}/_edit` | sign-in |
| R54 | `/wiki/commit/{sha}` | One wiki change | `repo/commit_page` | `/wiki/{page}/{sha}` | not attempted |
| R55 | `/activity`, `/activity/{period}` | Pulse | `repo/activity` | `/pulse` | activity |
| R56 | `/activity/contributors` | Contributors chart | `repo/activity` | `/graphs/contributors` | contributors |
| R57 | `/activity/code-frequency` | Additions and deletions over time | `repo/activity` | `/graphs/code-frequency` | code-frequency |
| R58 | `/activity/recent-commits` | Commits per week | `repo/activity` | `/graphs/commit-activity` | recent-commits |

GitHub has one pull request screen Gitea lacks: the Checks tab (`/pull/{n}/checks`). Gitea shows check states inside the merge box. The prompt asks for the tab.
The repository tab order in `templates/repo/header.tmpl` is: Code, Issues, Pull requests, Actions, Packages, Projects, Releases, Wiki, Activity, Settings. It matches the prompt.

### Settings

Repository settings, in the order of `templates/repo/settings/navbar.tmpl`. All need an owner signed in, so none was captured.

| # | Route | Purpose | Template | GitHub screen |
|---|---|---|---|---|
| S1 | `/settings` | General: name, description, units, merge options, signing, danger zone | `repo/settings/options` | `/settings` |
| S2 | `/settings/public_access` | What anonymous and signed-in visitors may read, per unit | `repo/settings/public_access` | none |
| S3 | `/settings/collaboration` | Collaborators and teams | `repo/settings/collaboration` | `/settings/access` |
| S4 | `/settings/hooks` | Webhook list | `repo/settings/webhook/base` | `/settings/hooks` |
| S5 | `/settings/hooks/{type}/new`, `/settings/hooks/{id}` | New or edit a webhook; eleven target kinds | `repo/settings/webhook/new` | `/settings/hooks/new` |
| S6 | `/settings/branches` | Default branch and protection rule list | `repo/settings/branches` | `/settings/branches` |
| S7 | `/settings/branches/edit` | One protection rule | `repo/settings/protected_branch` | `/settings/branch_protection_rules/new` |
| S8 | `/settings/tags`, `/settings/tags/{id}` | Protected tags | `repo/settings/tags` | `/settings/tag_protection` |
| S9 | `/settings/hooks/git`, `/settings/hooks/git/{name}` | Server-side git hooks | `repo/settings/githooks`, `repo/settings/githook_edit` | none |
| S10 | `/settings/keys` | Deploy keys | `repo/settings/deploy_keys` | `/settings/keys` |
| S11 | `/settings/lfs`, `/show/{oid}`, `/pointers`, `/find`, `/locks` | Large file list, one file, pointer check, find, locks | `repo/settings/lfs`, `lfs_file`, `lfs_pointers`, `lfs_file_find`, `lfs_locks` | none |
| S12 | `/settings/actions/general` | Enable Actions, token permissions | `repo/settings/actions` | `/settings/actions` |
| S13 | `/settings/actions/runners`, `/runners/{id}` | Runners | `repo/settings/actions`, `repo/settings/runner_edit` | `/settings/actions/runners` |
| S14 | `/settings/actions/secrets` | Secrets | `repo/settings/actions` | `/settings/secrets/actions` |
| S15 | `/settings/actions/variables` | Variables | `repo/settings/actions` | `/settings/variables/actions` |
| S16 | `/settings/audit_logs` | Audit log of the repository | `repo/settings/audit_logs` | none per repository |

User settings, in the order of `templates/user/settings/navbar.tmpl`. All need sign-in.

| # | Route | Purpose | Template | GitHub screen |
|---|---|---|---|---|
| S17 | `/user/settings` | Profile and avatar | `user/settings/profile` | `/settings/profile` |
| S18 | `/user/settings/account` | Password, emails, delete account | `user/settings/account` | `/settings/admin`, `/settings/emails` |
| S19 | `/user/settings/notifications` | Notification preferences | `user/settings/notifications` | `/settings/notifications` |
| S20 | `/user/settings/appearance` | Theme, language, hidden comment kinds | `user/settings/appearance` | `/settings/appearance` |
| S21 | `/user/settings/security`, `/security/two_factor/enroll` | Second factor, security keys, linked accounts | `user/settings/security/security`, `user/settings/security/twofa_enroll` | `/settings/security` |
| S22 | `/user/settings/blocked_users` | Blocked users | `user/settings/blocked_users` | `/settings/blocked_users` |
| S23 | `/user/settings/applications`, `/applications/oauth2/{id}` | Access tokens, OAuth applications, authorised applications | `user/settings/applications`, `user/settings/applications_oauth2_edit` | `/settings/tokens`, `/settings/developers`, `/settings/applications` |
| S24 | `/user/settings/keys` | SSH keys, GPG keys, principals | `user/settings/keys` | `/settings/keys` |
| S25 | `/user/settings/audit_logs` | Audit log of the account | `user/settings/audit_logs` | `/settings/security-log` |
| S26 | `/user/settings/actions/{general,runners,secrets,variables,scoped-workflows}` | Actions for all my repositories | `user/settings/actions`, `user/settings/actions_general`, `user/settings/runner_edit` | none for a user |
| S27 | `/user/settings/packages`, `/packages/rules/add`, `/rules/{id}`, `/rules/{id}/preview` | Package clean-up rules | `user/settings/packages`, `packages_cleanup_rules_edit`, `packages_cleanup_rules_preview` | none |
| S28 | `/user/settings/hooks`, `/hooks/{type}/new` | Webhooks for all my repositories | `user/settings/hooks`, `user/settings/hook_new` | none for a user |
| S29 | `/user/settings/organization` | My organisations | `user/settings/organization` | `/settings/organizations` |
| S30 | `/user/settings/repos` | My repositories | `user/settings/repos` | `/settings/repositories` |

Organisation settings, in the order of `templates/org/settings/navbar.tmpl`. All need an owner signed in.

| # | Route | Purpose | Template | GitHub screen |
|---|---|---|---|---|
| S31 | `/org/{org}/settings` | Name, description, visibility, danger zone | `org/settings/options` | `/organizations/{org}/settings/profile` |
| S32 | `/org/{org}/settings/hooks`, `/hooks/{type}/new` | Organisation webhooks | `org/settings/hooks`, `org/settings/hook_new` | `/organizations/{org}/settings/hooks` |
| S33 | `/org/{org}/settings/labels` | Labels shared by the organisation's repositories | `org/settings/labels` | `/organizations/{org}/settings/repository-defaults` |
| S34 | `/org/{org}/settings/applications`, `/applications/oauth2/{id}` | OAuth applications | `org/settings/applications`, `org/settings/applications_oauth2_edit` | `/organizations/{org}/settings/applications` |
| S35 | `/org/{org}/settings/blocked_users` | Blocked users | `org/settings/blocked_users` | `/organizations/{org}/settings/blocked_users` |
| S36 | `/org/{org}/settings/packages`, rules as S27 | Package clean-up rules | `org/settings/packages` and two more | none |
| S37 | `/org/{org}/settings/actions/{general,runners,secrets,variables,scoped-workflows}` | Actions for the organisation | `org/settings/actions`, `org/settings/actions_general`, `org/settings/runners_edit` | `/organizations/{org}/settings/actions` |
| S38 | `/org/{org}/settings/audit_logs` | Audit log of the organisation | `org/settings/audit_logs` | `/organizations/{org}/settings/audit-log` |

GitHub addresses in the Settings tables and in rows marked "not opened" are from memory of the product, not from a capture, because they need sign-in. Treat them as unverified.

The inventory holds 150 rows: 29 global, 15 user, 10 organisation, 58 repository, 38 settings. One row, G29, stands for the whole administration area; the other 149 are single screens.

## 2. Reference captures

Image files are outside the repository. To reproduce them:

1. Browser: Microsoft Edge, headless (`--headless=new`), driven over its debugging port. For each capture: set the viewport with `Emulation.setDeviceMetricsOverride` (1280 by 800, or 390 by 844 with the mobile flag), set `prefers-color-scheme` with `Emulation.setEmulatedMedia`, open the address, wait for the page to finish loading plus 2.5 seconds (6 for the three chart pages, 5 for the pull request diff), and take a screenshot of the viewport. No clicks, no scrolling, no sign-in, no consent given.
2. Theme: both sites follow `prefers-color-scheme` for signed-out visitors, so "light" and "dark" are that setting and nothing else.
3. GitHub: the addresses in the table, as a signed-out visitor.
4. Gitea: `docker run -d -p 127.0.0.1:3300:3000` of the image above with `GITEA__security__INSTALL_LOCK=true`, `GITEA__database__DB_TYPE=sqlite3`, `GITEA__server__ROOT_URL=http://localhost:3300/`, `GITEA__service__DISABLE_REGISTRATION=true`, `GITEA__actions__ENABLED=true`. One local account, `demo`, created with `gitea admin user create` inside the container and used only through an API token to seed data. The browser never signed in. The container was removed afterwards.
5. Seed, through Gitea's API: repository `demo/sample` (README, MIT licence, `src/app.js` of 40 lines, `src/util/format.js`, `docs/guide.md`, two topics); three labels; milestone `v1.0`; three issues with comments, one closed; open pull request 4 from `fix-padding` with one line comment; pull request 5 from `docs-tests`, merged; release `v0.1.0`; wiki pages Home and Setup; organisation `acme` with repository `tools`. No project, package or Actions run: those screens show their empty state.

Why a local instance: both public Gitea sites redirect signed-out visitors to the sign-in page for file, commit, blame, issue and compare pages (checked 2026-11-14: `gitea.com` and `demo.gitea.com` answer 303 to `/user/login` for those routes).

Each capture exists in four variants: 1280x800 light, 1280x800 dark, 390x844 light, 390x844 dark.
The capture's file name is `{site}/{identifier}-{width}x{height}-{theme}.png`.

| Capture | Gitea address | GitHub address | Notes |
|---|---|---|---|
| landing | `http://localhost:3300/` | `https://github.com/` | GitHub's is its marketing page; a reference for nothing but the header |
| explore-repos | `http://localhost:3300/explore/repos` | `https://github.com/search?q=gitea&type=repositories` |  |
| explore-users | `http://localhost:3300/explore/users` | `https://github.com/search?q=gitea&type=users` |  |
| explore-orgs | `http://localhost:3300/explore/organizations` | none | GitHub has no counterpart page |
| sign-in | `http://localhost:3300/user/login` | `https://github.com/login` |  |
| profile | `http://localhost:3300/demo` | `https://github.com/lunny` |  |
| org-home | `http://localhost:3300/acme` | `https://github.com/go-gitea` |  |
| repo-home | `http://localhost:3300/demo/sample` | `https://github.com/go-gitea/gitea` |  |
| tree | `http://localhost:3300/demo/sample/src/branch/main/src` | `https://github.com/go-gitea/gitea/tree/main/routers` |  |
| blob | `http://localhost:3300/demo/sample/src/branch/main/src/app.js` | `https://github.com/go-gitea/gitea/blob/main/main.go` |  |
| blob-lines | `http://localhost:3300/demo/sample/src/branch/main/src/app.js#L3-L6` | `https://github.com/go-gitea/gitea/blob/main/main.go#L10-L14` | Opened with a line range in the address; both sites highlight the range |
| blame | `http://localhost:3300/demo/sample/blame/branch/main/src/util/format.js` | `https://github.com/go-gitea/gitea/blame/main/main.go` |  |
| commits | `http://localhost:3300/demo/sample/commits/branch/main` | `https://github.com/go-gitea/gitea/commits/main` |  |
| commit | `http://localhost:3300/demo/sample/commit/b3e83fb25544747aa7fef52c8f649b13c32ddab4` | `https://github.com/go-gitea/gitea/commit/e2f451ae119b624756143df8bd6be6da5858d323` |  |
| graph | `http://localhost:3300/demo/sample/graph` | `https://github.com/go-gitea/gitea/network` | GitHub's graph was still loading when captured; the frame is shown, the graph is not |
| branches | `http://localhost:3300/demo/sample/branches` | `https://github.com/go-gitea/gitea/branches` |  |
| tags | `http://localhost:3300/demo/sample/tags` | `https://github.com/go-gitea/gitea/tags` |  |
| releases | `http://localhost:3300/demo/sample/releases` | `https://github.com/go-gitea/gitea/releases` |  |
| release | `http://localhost:3300/demo/sample/releases/tag/v0.1.0` | `https://github.com/go-gitea/gitea/releases/latest` | GitHub: redirected to `https://github.com/go-gitea/gitea/releases/tag/v28.3.0`. GitHub address is /releases/latest, which redirects to the newest tag |
| compare | `http://localhost:3300/demo/sample/compare/main...fix-padding` | `https://github.com/go-gitea/gitea/compare/e61305ee85098a21bd597c4471f9a01094554ddc...e2f451ae119b624756143df8bd6be6da5858d323` |  |
| code-search | `http://localhost:3300/demo/sample/search?q=format` | `https://github.com/search?q=repo%3Ago-gitea%2Fgitea+router&type=code` | GitHub shows "Sign in to search code" in place of results, so there is no GitHub reference for code search results |
| issues | `http://localhost:3300/demo/sample/issues` | `https://github.com/go-gitea/gitea/issues` |  |
| issue | `http://localhost:3300/demo/sample/issues/1` | `https://github.com/go-gitea/gitea/issues/4898` |  |
| labels | `http://localhost:3300/demo/sample/labels` | `https://github.com/go-gitea/gitea/labels` |  |
| milestones | `http://localhost:3300/demo/sample/milestones` | `https://github.com/go-gitea/gitea/milestones` |  |
| milestone | `http://localhost:3300/demo/sample/milestone/1` | `https://github.com/go-gitea/gitea/milestone/208` |  |
| pulls | `http://localhost:3300/demo/sample/pulls` | `https://github.com/go-gitea/gitea/pulls` |  |
| pull-open | `http://localhost:3300/demo/sample/pulls/4` | `https://github.com/go-gitea/gitea/pull/40355` | Signed out, so no comment box and no merge box controls on either site |
| pull-commits | `http://localhost:3300/demo/sample/pulls/4/commits` | `https://github.com/go-gitea/gitea/pull/40355/commits` |  |
| pull-files | `http://localhost:3300/demo/sample/pulls/4/files` | `https://github.com/go-gitea/gitea/pull/40355/files` |  |
| pull-merged | `http://localhost:3300/demo/sample/pulls/5` | `https://github.com/go-gitea/gitea/pull/40369` |  |
| actions | `http://localhost:3300/demo/sample/actions` | `https://github.com/go-gitea/gitea/actions` | Gitea: empty state, the sample has no workflows |
| actions-run | none | `https://github.com/go-gitea/gitea/actions/runs/43599606910` | GitHub: run summary only; the step log shows "Sign in to view logs". Gitea: no run to capture |
| wiki | `http://localhost:3300/demo/sample/wiki` | `https://github.com/ohmyzsh/ohmyzsh/wiki` | GitHub capture is from another public repository, because go-gitea/gitea has no wiki |
| wiki-pages | `http://localhost:3300/demo/sample/wiki/?action=_pages` | none | GitHub shows the page list as a box on every wiki page, not as a page |
| wiki-history | `http://localhost:3300/demo/sample/wiki/Home?action=_revision` | `https://github.com/ohmyzsh/ohmyzsh/wiki/Home/_history` |  |
| projects | `http://localhost:3300/demo/sample/projects` | `https://github.com/orgs/go-gitea/projects` | GitHub: redirected to `https://github.com/orgs/go-gitea/projects?query=is%3Aopen`. Both show an empty list; no board was captured on either site |
| activity | `http://localhost:3300/demo/sample/activity` | `https://github.com/go-gitea/gitea/pulse` |  |
| contributors | `http://localhost:3300/demo/sample/activity/contributors` | `https://github.com/go-gitea/gitea/graphs/contributors` | GitHub: redirected to `https://github.com/go-gitea/gitea/graphs/contributors?from=08%2F08%2F2026`. GitHub adds a date range to the address |
| code-frequency | `http://localhost:3300/demo/sample/activity/code-frequency` | `https://github.com/go-gitea/gitea/graphs/code-frequency` |  |
| recent-commits | `http://localhost:3300/demo/sample/activity/recent-commits` | `https://github.com/go-gitea/gitea/graphs/commit-activity` |  |
| forks | `http://localhost:3300/demo/sample/forks` | `https://github.com/go-gitea/gitea/forks` |  |
| stars | `http://localhost:3300/demo/sample/stars` | `https://github.com/go-gitea/gitea/stargazers` | GitHub: 0 of 4 variants captured (404, 404, 404, 404). GitHub answers 404 to a signed-out visitor, so there is no GitHub reference |
| watchers | `http://localhost:3300/demo/sample/watchers` | `https://github.com/go-gitea/gitea/watchers` | GitHub: 0 of 4 variants captured (404, 404, 404, 404). GitHub answers 404 to a signed-out visitor, so there is no GitHub reference |
| packages | `http://localhost:3300/demo/-/packages` | `https://github.com/orgs/go-gitea/packages` | Gitea: empty state. GitHub: at 390 wide the page is 392 wide and scrolls sideways |
| not-found | `http://localhost:3300/demo/nothing-here` | `https://github.com/go-gitea/nothing-here` | Both answer 404, which is the screen wanted |

46 capture identifiers; 89 site pages; 87 of them captured in all four variants; 348 usable images. Incomplete: github/stars, github/watchers.

Screens with no capture are marked in the inventory. In total:

| Inventory rows | Count |
|---|---|
| With at least one capture | 43 |
| No capture: needs sign-in (includes all 38 settings rows) | 77 |
| No capture: needs data or a condition the sample lacks | 15 |
| No capture: not attempted | 14 |
| Not a separate page | 1 |

## 3. Component inventory

### Tokens

All values are from `@primer/primitives` 11.10.0, read by script. "File" is under `dist/css/`. Sizes are in rem in the package; 1 rem is 16 px.

| What | Token | Value | File |
|---|---|---|---|
| Body text | `--text-body-size-medium`, `--text-body-lineHeight-medium`, `--text-body-weight` | 0.875rem (14 px), 1.5, 400 | `functional/typography/typography.css`, `base/typography/typography.css` |
| Small text | `--text-body-size-small`, `--text-caption-size` | 0.75rem (12 px) | same |
| Large body | `--text-body-size-large` | 1rem (16 px) | same |
| Titles | `--text-title-size-small`, `-medium`, `-large`; weight | 1rem, 1.25rem, 2rem; 600 | same |
| Code | `--text-codeBlock-size`, `--text-codeInline-size` | 0.8125rem (13 px); 0.9285em | `functional/typography/typography.css` |
| Weights | `--base-text-weight-normal`, `-medium`, `-semibold` | 400, 500, 600 | `base/typography/typography.css` |
| Text font | `--fontStack-system` | "Mona Sans VF", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Backtick Fix", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji" | `functional/typography/typography.css` |
| Code font | `--fontStack-monospace` | ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace | same |
| Control height | `--control-xsmall-size`, `-small-`, `-medium-`, `-large-`, `-xlarge-` | 1.5, 1.75, 2, 2.5, 3 rem (24, 28, 32, 40, 48 px) | `functional/size/size.css` |
| Control padding, medium | `--control-medium-paddingInline-condensed`, `-normal`, `-spacious`; `--control-medium-paddingBlock`; `--control-medium-gap` | 8, 12, 16 px; 6 px; 8 px | same |
| Control padding, small | `--control-small-paddingInline-normal`, `--control-small-paddingBlock`, `--control-small-gap` | 12 px; 4 px; 4 px | same |
| Touch target | `--control-minTarget-coarse`, `-fine` | 44 px, 16 px | same |
| Radius | `--borderRadius-small`, `-medium` (default), `-large`, `-full` | 3 px, 6 px, 12 px, pill | `functional/size/radius.css` |
| Border | `--borderWidth-thin` (default), `-thick`, `-thicker` | 1 px, 2 px, 4 px | `functional/size/border.css` |
| Focus ring | `--focus-outline-width`, `--focus-outline-offset`, colour `--focus-outline-color` | 2 px, -2 px, the accent border colour | `functional/size/border.css`, theme files |
| Spacing scale | `--base-size-2` to `-128` | 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 64, 80, 96, 112, 128 px | `base/size/size.css` |
| Stack gaps and padding | `--stack-gap-condensed`, `-normal`, `-spacious` (padding the same) | 8, 16, 24 px | `functional/size/size.css` |
| Dialog and menu sizes | `--overlay-width-xsmall` to `-xlarge`; `--overlay-height-small` to `-xlarge`; `--overlay-borderRadius`; `--overlay-padding-normal`, `-condensed` | 192, 320, 480, 640, 960 px; 256, 320, 432, 600 px; 6 px; 16, 8 px | same |
| Breakpoints | `--breakpoint-xsmall`, `-small`, `-medium`, `-large`, `-xlarge`, `-xxlarge` | 320, 544, 768, 1012, 1280, 1400 px | `functional/size/breakpoints.css` |

Colour roles. Values shown so a reviewer can check the build; Phase 1 takes them from the package, not from this table.

| Role | Token | Light (`themes/light.css`) | Dark (`themes/dark.css`) |
|---|---|---|---|
| Page background | `--bgColor-default` | #ffffff | #0d1117 |
| Panel background | `--bgColor-muted` | #f6f8fa | #151b23 |
| Inset background | `--bgColor-inset` | same as muted | #010409 |
| Text | `--fgColor-default` | #1f2328 | #f0f6fc |
| Secondary text | `--fgColor-muted` | #59636e | #9198a1 |
| Link | `--fgColor-accent` (`--fgColor-link`) | #0969da | #4493f8 |
| Border | `--borderColor-default`, `--borderColor-muted` | #d1d9e0, #d1d9e0b3 | #3d444d, #3d444db3 |
| Control background | `--control-bgColor-rest`, `-hover` | #f6f8fa, #eff2f5 | #212830, #262c36 |
| Primary button | `--button-primary-bgColor-rest` (success emphasis), `-hover` | #1f883d, #1c8139 | #238636, #29903b |
| Open | `--fgColor-open`, `--bgColor-open-emphasis` | #1a7f37, #1f883d | #3fb950, #238636 |
| Closed | `--fgColor-closed`, `--bgColor-closed-emphasis` | #d1242f, #cf222e | #f85149, #da3633 |
| Merged | `--fgColor-done`, `--bgColor-done-emphasis` | #8250df, #8250df | #ab7df8, #8957e5 |
| Draft | `--fgColor-draft`, `--bgColor-draft-emphasis` | #59636e, #59636e | (neutral) #656c76 emphasis |
| Success, failure, pending | `--fgColor-success`, `--fgColor-danger`, `--fgColor-attention` | #1a7f37, #d1242f, #9a6700 | #3fb950, #f85149, #d29922 |
| Added line, added word, added line number | `--diffBlob-additionLine-bgColor`, `-additionWord-`, `-additionNum-` | #dafbe1, #aceebb, #aceebb | #2ea04326, #2ea04366, #3fb9504d |
| Removed line, word, line number | `--diffBlob-deletionLine-bgColor`, `-deletionWord-`, `-deletionNum-` | #ffebe9, #ffcecb, #ffcecb | #f851491a, #f8514966, #f851494d |
| Hunk header | `--diffBlob-hunkLine-bgColor`, `--diffBlob-hunkNum-bgColor-rest` | #ddf4ff, #b6e3ff | accent muted #388bfd1a |
| Selected tab underline | `--underlineNav-borderColor-active` | #fd8c73 | #f78166 |
| Heatmap, five steps | `--contribution-default-bgColor-0` to `-4` | #eff2f5, #aceebb, #4ac26b, #2da44e, #116329 | #151b23, #033a16, #196c2e, #2ea043, #56d364 |
| Counter | `--counter-bgColor-muted` (neutral muted) | #818b981f | #656c7633 |
| Dialog backdrop | `--overlay-backdrop-bgColor` | #c8d1da66 | #21283066 |
| Flash and badge backgrounds | `--bgColor-success-muted`, `-danger-muted`, `-attention-muted`, `-accent-muted` with the matching `--borderColor-*-muted` | #dafbe1, #ffebe9, #fff8c5, #ddf4ff | #2ea04326, #f851491a, #bb800926, #388bfd1a |

Themes shipped in the package (`dist/css/functional/themes/`): light, dark, dark-dimmed, light-high-contrast, dark-high-contrast, dark-dimmed-high-contrast, and colour-blind and tritanopia variants of light and dark with their high-contrast forms: fourteen files. Dimmed and high contrast do come free with the tokens.

### Measured on github.com

Computed styles of the first visible match, 1280x800, light, signed out, 2026-11-14. Height is the rendered box; "content" means the height follows the content and only the type matters. The header is the signed-out one; the signed-in header was not seen. Selectors are guesses at GitHub's markup; a component with no match is listed after the table and has no measurement.

| Component | From capture | Element | Height | Padding | Radius | Border, top / bottom | Font: size weight / line |
|---|---|---|---|---|---|---|---|
| body | github/repo-home | `body` | content | 0px | 0px | 0px / 0px | 14px 400 / 21px |
| global header | github/repo-home | `header` | 68 px | 0px | 0px | 0px / 0px | 16px 400 / 24px |
| repository tab | github/repo-home | `a` | 32 px | 6px 8px | 6px | 0px / 0px | 14px 400 / 21px |
| repository tab bar | github/repo-home | `nav` | 48 px | 8px 16px 0px | 0px | 0px / 0px | 14px 400 / 21px |
| primary button (Code) | github/repo-home | `button` | 32 px | 0px 12px | 6px | 1px / 1px | 14px 500 / 21px |
| default button (branch) | github/repo-home | `button` | 32 px | 0px 12px | 6px | 1px / 1px | 14px 500 / 21px |
| counter | github/explore-repos | `span` | 20 px | 0px 8px | 20px | 1px / 1px | 12px 600 / 20px |
| file table row | github/repo-home | `tr` | 40 px | 0px | 0px | 0px / 0px | 14px 400 / 21px |
| file table cell | github/repo-home | `td` | 40 px | 0px 0px 0px 16px | 0px | 0px / 0px | 14px 400 / 21px |
| latest commit bar | github/repo-home | `div` | 28 px | 0px | 0px | 0px / 0px | 14px 400 / 21px |
| readme body | github/repo-home | `article` | content | 0px | 0px | 0px / 0px | 16px 400 / 24px |
| avatar | github/issue | `img` | 24 px | 0px | 50% | 0px / 0px | 14px 400 / 14px |
| code line | github/blob | `div` | 20 px | 0px 10px | 0px | 0px / 0px | 12px 400 / 20px |
| code line number | github/blob | `div` | 20 px | 0px 16px | 0px | 0px / 0px | 12px 400 / 20px |
| blob toolbar button | github/blob | `a` | 28 px | 0px 8px | 6px 0px 0px 6px | 1px / 1px | 12px 500 / 18px |
| commit row | github/commits | `li` | 71 px | 0px | 6px 6px 0px 0px | 0px / 1px | 14px 400 / 21px |
| label | github/issues | `span` | 20 px | 0px 8px | 9999.01px | 1px / 1px | 12px 600 / 12px |
| state badge | github/issue | `span` | 32 px | 8px 12px | 9999.01px | 0px / 0px | 14px 600 / 16px |
| page title | github/issue | `h1` | 40 px | 0px | 0px | 0px / 0px | 32px 400 / 40px |
| timeline comment | github/issue | `div` | content | 0px | 0px | 0px / 0px | 14px 400 / 21px |
| timeline comment header | github/issue | `div` | 37 px | 4px 4px 4px 8px | 6px 6px 0px 0px | 0px / 1px | 14px 400 / 19.25px |
| timeline event item | github/issue | `li` | 64 px | 24px 0px 8px | 0px | 0px / 0px | 14px 400 / 21px |
| comment body text | github/issue | `div` | content | 0px | 0px | 0px / 0px | 16px 400 / 24px |
| pull request tab | github/pull-open | `a` | 40 px | 8px 12px | 6px 6px 0px 0px | 1px / 0px | 14px 400 / 22.96px |
| diff file header | github/commit | `div` | 46 px | 6px 8px | 6px 6px 0px 0px | 1px / 1px | 14px 400 / 21px |
| diff line number | github/commit | `td` | 24 px | 0px | 0px | 0px / 0px | 14px 400 / 14px |
| diff code cell | github/commit | `div` | 24 px | 0px | 0px | 0px / 0px | 12px 400 / 24px |
| pagination item | github/commits | `a` | 32 px | 8px 6px | 6px | 0px / 0px | 14px 400 / 14px |
| heatmap cell | github/profile | `td` | 10 px | 0px | 2px | 1px / 1px | 14px 400 / 21px |
| underline nav item (profile) | github/profile | `a` | 30 px | 0px 8px | 6px | 0px / 0px | 14px 600 / 30px |
| text input | github/sign-in | `input` | 40 px | 5px 12px | 6px | 1px / 1px | 16px 400 / 20px |
| sign-in button | github/sign-in | `input` | 40 px | 5px 16px | 6px | 1px / 1px | 14px 500 / 20px |
| flash message | github/pull-open | `div` | 74 px | 20px 16px | 6px | 1px / 1px | 14px 400 / 21px |
| box (bordered container) | github/profile | `div` | content | 16px | 6px | 1px / 1px | 14px 400 / 21px |
| footer | github/repo-home | `footer` | 113 px | 48px 16px 40px | 0px | 0px / 0px | 12px 400 / 18px |

No match, so not measured: header search control; small button (Star/Fork/Watch); sidebar heading; topic tag; issue row; blankslate (empty state).

### The parts, and where each one's numbers come from

"Token" means the value is in the token table. "Measured" means the row of that name above. "Not measured" means neither: Phase 1 must measure it from the captures or with a signed-in session.

| Component | Height | Padding | Radius | Border | Type | Icons (Octicons 19.42.0, 16 px) |
|---|---|---|---|---|---|---|
| Header | Measured: global header, signed-out form only | Measured | none | not measured | not measured for the signed-in form | `three-bars`, `search`, `plus`, `bell`, `inbox`, `issue-opened`, `git-pull-request` |
| Repository header with tabs | Measured: repository tab, tab bar | Measured | Measured: 6 px | underline colour from the token; width not measured | Measured: 14 px, 400; selected weight not measured | `code`, `issue-opened`, `git-pull-request`, `play`, `package`, `table`, `tag`, `book`, `graph`, `gear`; `eye`, `repo-forked`, `star` for Watch, Fork, Star |
| File table | Measured: file table row, cell | Measured | 6 px on the outer box (token) | 1 px box, 1 px between rows (token) | 14 px; muted colour for message and time | `file-directory-fill`, `file`, `file-submodule`, `file-symlink-file` |
| Commit row | Measured: commit row | Measured | 6 px on the group box | 1 px | Measured: 14 px; title weight not measured | `copy`, `code`, `verified`, `check`, `x`, `dot-fill` |
| Diff view | Measured: diff file header, line number, code cell | Measured | 6 px on the file box | 1 px | Measured: 12 px monospace; 24 px line in diffs, 20 px in file view; 13 px is the code-block token | `chevron-down`, `chevron-right`, `unfold`, `fold`, `kebab-horizontal`, `diff-added`, `diff-removed`, `diff-modified`, `diff-renamed` |
| Timeline item | Measured: timeline comment, header, event item | Measured | 6 px | 1 px; the connecting line was not measured | Measured: 14 px | one per event: `tag`, `person`, `milestone`, `git-commit`, `git-merge`, `issue-closed`, `issue-reopened`, `lock`, `pin`, `cross-reference`, `eye`, `comment` |
| Comment box | Not measured (signed in only) | not measured | token: 6 px | token: 1 px; focus ring 2 px | token: 14 px | `markdown`, `heading`, `bold`, `italic`, `quote`, `code`, `link`, `list-unordered`, `list-ordered`, `tasklist`, `mention`, `paperclip` |
| Label | Measured: label | Measured | pill (token: full) | 1 px | Measured: 12 px, 600 | none |
| State badge | Measured: state badge | Measured | pill | Measured | Measured | `issue-opened`, `issue-closed`, `skip`, `git-pull-request`, `git-merge`, `git-pull-request-closed`, `git-pull-request-draft` |
| Button kinds | token: 32 px default, 28 px small, 40 px large | token: 12 px inline | 6 px | 1 px | 14 px, 500 (12 px for small) | leading and trailing icon 16 px; `triangle-down` for menus |
| Dropdown menu | token: item 32 px; menu width 192 to 320 px | token: 8 px | token: 6 px | 1 px, plus the floating shadow token | 14 px | `check` for the selected item |
| Dialog | token: width 320, 480 or 640 px | token: 16 px | token: 6 px (`--overlay-borderRadius`); not measured on the site | 1 px; backdrop colour token | token: 14 px body; title not measured | `x` to close |
| Tab bar (underline) | Measured: underline nav item, pull request tab | Measured | Measured | underline width not measured | Measured | per tab |
| Pagination | Measured: pagination item | Measured | Measured | Measured | Measured | `chevron-left`, `chevron-right` |
| Empty state | not measured (no match) | not measured | token: 6 px | not measured | not measured | one 24 px icon |
| Flash message | Measured: flash message (the sign-in banner on a pull request) | Measured | Measured | Measured; colour by role token | Measured | `info`, `check-circle`, `alert`, `stop` |
| Avatar | Measured: avatar | none | Measured; round for people in the captures | token: `--avatar-borderColor` | none | none |
| Heatmap | Measured: heatmap cell (10 px squares) | gap not measured | Measured: 2 px | Measured: 1 px | labels not measured | none |
| Counter | Measured: counter (20 px) | Measured: 0 8 px | pill | 1 px, transparent (token) | Measured: 12 px, 600 | none |

All icon names above were checked to exist as `{name}-16.svg` in the package's `build/svg/`. The package holds 408 icons: 407 at 16 px, 366 at 24 px, 9 at 12 px.

Three findings against the prompt's "Density" sentence, which asks to be checked:

1. 14 px body, 32 px controls, 6 px radius and 1 px borders are all confirmed by the tokens.
2. The package's font stack begins with "Mona Sans VF", a web font. The prompt says no web fonts are downloaded. Drop that first entry; the rest is the system stack.
3. Code on github.com is 12 px, in a 20 px line in the file view and a 24 px line in diffs (measured), not the 13 px code-block token.

## 4. Interaction inventory

### Keyboard shortcuts

GitHub's, from its documentation page (122 rows in thirteen sections, parsed by script). The prompt's list against it:

| Key | Prompt says | GitHub's documentation says | Gitea at the pinned commit |
|---|---|---|---|
| `/` | focus search | "S" or "/" focuses the search bar | `s` focuses code search on the repository home (`templates/repo/home_sidebar_top.tmpl:6`) |
| `t` | file finder | activates the file finder | `t` (`web_src/js/components/RepoFileSearch.vue:157`) |
| `y` | permalink | expands the address to its canonical form | no key; a "Copy permalink" entry in the line menu |
| `l` | jump to line | jump to a line; in lists, filter by label | none |
| `b` | blame | open blame view | none |
| `w` | switch branch | switch to a new branch or tag | none |
| `g c`, `g i`, `g p` | go to Code, Issues, Pull requests | the same; also `g a` Actions, `g w` Wiki, `g n` notifications | `g c`, `g i`, `g p`, `g a`, `g b` (projects), `g r` (releases), `g w`, `g n` (`templates/repo/header.tmpl`, `templates/base/head_navbar_icons.tmpl:40`) |
| `.` | open the editor | opens github.dev, which needs sign-in | none |
| `c` | new issue | create an issue (in lists) | none |
| `e` | edit file | open the file in the editor | none |
| `j`, `k` | move in lists | not in the parsed tables for issue lists; `Shift J` highlights a code line | none |
| `Ctrl+Enter` | submit | submits a comment | the same (`web_src/js/features/common-form.ts`) |
| `Ctrl+K` | command palette | opens the command palette, which the page describes as a public preview; in a text field `Ctrl+K` inserts a link and the palette moves to `Ctrl+Alt+K` | no global palette; one inside the code editor on `Mod-Shift-p` or `F1` (`web_src/js/modules/codeeditor/main.ts:210`) |
| `?` | help dialog | "Typing ? on GitHub brings up a dialog box that lists the keyboard shortcuts available for that page" | the same; the dialog is built from the shortcuts present on the page (`web_src/js/modules/shortcut.ts:71` and `:160`) |

Also documented by GitHub and worth having: `r` quotes the selected text in a reply; `Ctrl+Shift+P` switches Write and Preview; `Ctrl+B`, `Ctrl+I`, `Ctrl+E` format text; `Ctrl+G` inserts a suggestion; `q`, `m`, `l`, `a` set reviewer, milestone, label, assignee on an issue or pull request; `u` filters a list by author; in Files changed, `t` focuses the file filter and `c` opens the commit picker.
Two decisions for Phase 1: `j` and `k` are in the prompt but not in the documentation tables read here; and `Ctrl+K` must mean "insert link" inside a text field, as on GitHub.

### File finder

GitHub: `t` on any Code screen; fuzzy match on path; arrow keys and Enter (documentation, "Source code browsing"). Not exercised in a capture.
Gitea: an in-page box labelled "Go to file" with a `T` hint (visible in capture `gitea/repo-home`); Arrow keys, Enter and Escape handled in `RepoFileSearch.vue` lines 48 to 67; the file list comes from `/tree-list/{ref}` (`web.go:1272`).

### Permalinks

GitHub: `y` replaces the branch name in the address with the commit identifier (documentation: "Expand a URL to its canonical form").
Gitea: files are always addressable by commit as `/src/commit/{sha}/{path}` (`web.go:1724`); the line menu offers a permalink copy (`a.copy-line-permalink`, `repo-code.ts:20`).

### Line selection

Both write the selection into the address fragment: `#L14` for one line and `#L14-L26` for a range (Gitea: `repo-code.ts` lines 14 and 53; captures `github/blob-lines`, opened with `#L10-L14`, and `gitea/blob-lines`, opened with `#L3-L6`, both show the range highlighted, and Gitea scrolls to it). Shift-click extends a selection in both; on GitHub that is documented for pull request diffs ("Comment on multiple lines ... holding Shift").

### Command palette

GitHub: opened with `Ctrl+K` or `Ctrl+Alt+K` (`Command` on a Mac); scoped to where you are; can navigate, search and run commands; described on its documentation page as a public preview. Not captured: it needs sign-in.
Gitea: none outside the code editor.

### How forms report errors

Gitea: a full-page form that fails is rendered again with a flash message at the top (`templates/base/alert.tmpl`) and the failing field marked; actions sent in the background show a toast (`showErrorToast` in `web_src/js/modules/toast.ts`, used across `web_src/js/features/`).
GitHub: not observed in this study, because every form needs sign-in. What the prompt asks ("errors say what happened and what to do next") is the rule to build to; the field-level wording in `docs/UI-STRINGS.md` assumes a message under the field and focus moved to it, which is the WCAG 2.2 expectation the prompt also sets.

### What is optimistic

Not measured on either site: it needs signed-in writes. The prompt's rule stands in for evidence here: every action is applied locally at once, then published, with a small "not published" marker and no blocking spinner.

## 5. Where the current page stands

`web/app.js` (526 lines), `web/shell.js`, `web/index.html`, `web/style.css` (71 lines) at commit `aeeb97f`. Routes are fragments (`#/{name}/{view}/{ref}/{path}`), read in `route()` at `web/app.js:494`.

| Current route | What it shows | Inventory screen | What is missing against it |
|---|---|---|---|
| `#/` | Address box with Clone; list of repositories in this browser | G1, G2 in part | Landing copy and single action; dashboard feed, heatmap, repository filter and tabs; header with search, Issues, Pull requests, Explore, bell, plus and avatar menus |
| `#/{name}/tree/{ref}/{path}` | Breadcrumb, latest commit line, file table (name and short id), README as plain text | R1, R4 | Owner in the address and header; visibility badge, Watch, Fork, Star; last commit per row; file finder; Add file; Code button with clone addresses and archive; sidebar (about, topics, releases, languages); rendered Markdown; icons; a real branch and tag switcher (today a plain `select`) |
| `#/{name}/blob/{ref}/{path}` | Size line, Blame and Edit links, numbered lines | R5 | Syntax highlighting; line and range selection in the address; Raw, History, Delete, permalink; rendered view for Markdown and images; symbol and line menus |
| `#/{name}/blame/{ref}/{path}` | Blame by first-parent history | R6 | Avatars, commit titles, age colouring, "blame prior to this change" |
| `#/{name}/commits/{ref}` | Up to 100 commits in a table; also fetch, push, storage keys, access list and branch protection in fold-out panels | R7, and parts of S3, S6, S7 | Grouping by day; pagination; Verified badges; author filter; file history. The panels belong in Settings and in a sync control, not here |
| `#/{name}/commit/{sha}` | Message, author, identifiers, unified diff per file | R9 | Split view; file tree; per-file collapse; whitespace toggle; line comments; Verified badge; patch and diff downloads |
| `#/{name}/edit/{ref}/{path}` | Text area, commit message, name and email, Commit and Propose buttons | R15 in part | New file, delete, upload, rename; an editor with line numbers; preview of changes; branch choice as GitHub's commit dialog |
| `#/{name}/resolve/{ref}` | Conflicts from the last fetch, one editor or one choice per file | none in Gitea; GitHub's conflict editor on a pull request | Attachment to the pull request merge box; conflict navigation |
| `#/{name}/pulls/{ref}` | Table of pull requests with approval count | R32 in part | Open and closed counts; filters, sort and search; labels, milestones, assignees; state icons. The list is keyed by a branch in the address, which GitHub's is not |
| `#/{name}/pull/{number}` | State, approvals, required checks, Approve and Merge buttons, the whole diff | R33 and R35 collapsed into one | Conversation timeline and comments; Commits, Checks and Files changed tabs; review on lines; merge method menu; delete branch; sidebar |
| footer | Object and decision counts; the page's pinned digest; new-version prompt | none | To move into the About dialog, per the prompt |

Ten routes touch twelve of the inventory's screens. None is complete against its row. Nothing exists yet for issues, labels, milestones, releases, tags, branches as lists, wiki, projects, packages, actions, activity, search, notifications, explore, profiles, organisations, or any Settings page.

Facts about the frame that Phase 1 will meet first:

- Addresses are fragments. The prompt asks for paths answered by the service worker. `web/sw.js` exists and pins the page's files; it does not answer navigation yet.
- There is no owner in any address. A repository is known by a bare name (`getRepo(name)`, `web/app.js:499`). GitHub's `/{owner}/{repo}` needs an owner concept first.
- `web/style.css` lines 2 to 8 type eighteen colours by hand, and body text is 15 px (line 11). Both go when tokens arrive.
- `web/index.html:6` sets `style-src 'self'` and `img-src 'self'`. Inlined SVG icons are unaffected; avatars and images from repositories will need `blob:` or `data:` allowed for images.
- There are no icons: a directory is marked with a text arrow (`web/app.js:107`).
- People are shown as the first 8 or 16 characters of a key (`web/app.js:282`, `:371`).
- Tests: `package.json` runs ten `node --test` files holding 92 `test(` calls, which matches the prompt's count. They run under Node with `fake-indexeddb`; no browser engine is among the dependencies. The prompt's gate asks for tests that drive each screen "in a real browser engine", so that tooling is new work.

## 6. Not verified, and where the prompt was wrong

- No signed-in screen was captured on either site: dashboard, notifications, every form, every Settings page, the comment box, dialogs and menus. Their rows in the inventory say so. Their component numbers come from tokens only.
- GitHub addresses for signed-in screens are from memory, not from a capture.
- The measured table depends on guessed selectors. Components not found are listed under it.
- Captures are of the viewport, not the full page, and no menu, dialog or hover state was opened.
- The Gitea in the captures is one day newer than the source that was read.
- `options/locale/locale_en-US.ini`, named in the prompt and the brief, does not exist at the pinned commit. The file is `locale_en-US.json`.
- The prompt says eleven features cannot exist. `docs/PARITY.md` lists ten; the re-verification proposes six more.
- The prompt asks for tests in a real browser engine. The 92 existing tests run under Node; the repository has no browser test tooling today.
- The prompt asks for GitHub's "system font stack"; the published stack starts with a web font.
- The prompt puts the command palette on `Ctrl+K` without the text-field exception GitHub documents, and lists `j` and `k`, which the documentation tables do not.
- Gitea has no Checks tab on a pull request and no global command palette; the prompt asks for both. They are GitHub screens, which rule 1 allows, but they have no Gitea template to follow.
- The prompt's last section reads a supplied picture of a 3D editor with docked panels as a reference for density, not layout, and asks for confirmation before Phase 1. That is still open. Nothing in this study depends on it.
