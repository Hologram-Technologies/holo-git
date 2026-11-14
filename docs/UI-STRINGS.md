# Interface strings

Phase 0 of `docs/PROMPT-UI.md`. Read from `web/` at commit `aeeb97f` on 2026-11-14.
This is the map from what the page says today to what it should say. Phase 1 turns the right-hand column into the single strings file the prompt asks for.

Result: 208 rows cover every string the page can show. 43 contain a banned word (replica 22, record 10, grant 5, signed log 4, holo 3, kernel 3, digest 2, engine 2, label 1).
A row may stand for several near-identical messages; the source lines are listed.
The "Banned words" column was computed by pattern, not typed. "label" is flagged only where it has the content-address sense; no current string uses it for an issue label.

## Rules, from the prompt's "Words" section

Sentence case. Verbs on buttons. No exclamation marks. No explaining how it works unless the user asked.
An error says what happened and what to do next. An empty state has one line and one action.
If removing a piece of text loses nothing, remove it.
Trust details appear in two places only: the panel opened by clicking a Verified badge, and the About dialog reached from the footer, which holds the page's integrity value.

## Banned words

Never shown to a user, anywhere, including errors, tooltips and settings (`docs/PROMPT-UI.md`, "Words"):

Prism, UOR, kappa, holo, LexLean, kernel, engine, fold, record, signed log, replica, action key, digest, label (in the content-address sense), attestation, delegation, grant, closure, manifest, wasm.

Twenty terms. The scan in Phase 9 should match them case-insensitively, as whole words for "fold", "record", "grant" and "UOR", and as substrings for the rest.
"label" needs an allow-list, because issue labels are a feature: allow it in the Issues, Pull requests and Labels screens, ban it elsewhere.

## Replacement table

From the prompt, unchanged:

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
| signed and verified | the Verified badge |
| the log is invalid | "This repository's history has been tampered with", then what to do |

Proposed additions. These words are not on the banned list but appear in the current page and would not appear on a git host:

| Today | Proposed | Why |
|---|---|---|
| device ("this device", "on this device") | "this browser", or "you" | The prompt's table already maps "device key"; the bare word is on 17 lines of web/app.js. |
| object, objects (counts in status lines) | nothing; drop the count | A git-host user counts commits and files. |
| `sha1:` and `sha256:` prefixes on identifiers | the bare short identifier, 7 characters, with a copy button | The prefix is the content-address form. |
| pinned, pinning (of the page) | "Version" and "Integrity value" in the About dialog | Only place the prompt allows it. |
| store ("the store refused") | storage | Matches the table's "storage". |
| "refused:" prefix on errors | the reason, then the next step | The prompt's error rule. |
| a person shown as 8 or 16 hexadecimal characters | name and avatar; the key is in the Verified panel | A key is not a name. Needs profiles (parity row "Profiles, follow"). |
| `yyyy-mm-dd` dates | relative time ("3 days ago") with the full date as a tooltip | Not a banned word; listed because every list uses it. |

## Open questions

1. The product's name contains a banned word. "holo" is on the list, and "holo-git" is the page title, the heading on every screen and the name in one error. Either the name is exempt from the ban, or the product needs another name. The prompt says "The product has its own name and a plain mark" and does not say which. The table marks these rows; it does not decide.
2. The checks file path is `.holo/checks.json`. The prompt both bans "holo" in the interface and requires checks to stay defined at that path. The path will be visible wherever the file tree, a diff or an error names it. A file name inside a repository is content, not interface wording, so the proposal here is to exempt paths and never repeat the path in interface text (the proposed error says "checks.json").
3. People are identified by a key today. Every proposed string that says "{name}" assumes a profile exists. Until it does, the fallback wording needs a decision: a short key is implementation detail, but nothing else identifies the person.
4. "Push" or "Publish". The prompt allows both. Proposed: "Publish" the first time a repository or branch goes to a remote, "Push" after, as desktop git clients do. Not verified against a source; a preference to confirm.

## Every string the page shows today

## Page frame

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/index.html:7` | holo-git | **holo** |  | {product name} — the title of each screen comes first, as "{screen} · {owner}/{repository}" |
| `web/index.html:11` | Loading… |  |  | Remove. First paint shows the frame; content fills in. |
| `web/app.js:49, 89, 515` | holo-git | **holo** |  | The product name and mark. The current name contains a banned word; see Open questions. |
| `web/app.js:37` | {n} objects stored · {n} read this session, each re-verified · {n} decisions by the proved kernel | **kernel** | object | Remove from the footer. The About dialog may say "Everything shown was verified in this browser." |
| `web/app.js:38` |  · {n} REFUSED |  |  | Flash, error: "Some files failed verification and were not shown. Open the repository again from its remote." |
| `web/shell.js:12` | This browser has no service worker, so the page is not pinned. |  | pinned | About dialog only: "Offline use is not available in this browser." |
| `web/shell.js:19` | Page not pinned: {message} |  | pinned | About dialog only: "Offline use could not be set up." |
| `web/shell.js:25` | Pinning this page… |  | pinned | Remove. |
| `web/shell.js:28` | page pinned to sha256:{id}… · {n} files, each checked against its digest on every load | **digest** | sha1:/sha256: prefix, pinned | Remove from the footer. About dialog: "Version" and "Integrity value" with a copy button. |
| `web/shell.js:29` | Page not pinned. |  | pinned | Remove. |
| `web/shell.js:37` | A new version of this page is waiting: sha256:{id}…. Nothing changes until you accept it.  |  | sha1:/sha256: prefix | "A new version is available." The integrity value is in the About dialog. |
| `web/shell.js:35` | Accept and reload |  |  | Update and reload |

## Home (web/app.js home)

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:90` | Clone a repository from any static replica. Every object is checked against its address before it is stored, and again every time it is read. | **replica** | object | Landing line with one action: "Git hosting that runs in your browser." |
| `web/app.js:76` | https://example.org/project.git |  |  | https://example.org/owner/repository.git |
| `web/app.js:76` | Replica address | **replica** |  | Repository address |
| `web/app.js:86` | Clone |  |  | Open repository |
| `web/app.js:83` | Cloned {n} objects, {n} bytes, in {n} ms. |  | object | Remove. Go straight to the repository. |
| `web/app.js:85` | Clone failed: {message} |  |  | Could not open this repository. {plain reason}. Check the address and try again. |
| `web/app.js:92` | On this device |  | device | Repositories |
| `web/app.js:95` |  · {n} objects · from {address} |  | object | Updated {relative time}. The address moves to the repository's Settings. |

## Repository header and Code

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:45` | Branch or tag |  |  | Switch branches or tags |
| `web/app.js:51` | Code |  |  | Code |
| `web/app.js:52` | Commits |  |  | Not a tab. Becomes the "{n} commits" link on the Code tab. |
| `web/app.js:53` | Pull requests |  |  | Pull requests |
| `web/app.js:107` | ▸  |  |  | Folder icon; accessible name "Directory". |
| `web/app.js:108` | {7 hex of the entry} |  |  | Remove. The row shows the last commit message and its relative time. |
| `web/app.js:112` | {author} {commit subject} · {7 hex} · {yyyy-mm-dd} |  |  | Same parts in the latest-commit bar; time as "3 days ago"; "{n} commits" at the right. |
| `web/app.js:129` | sha1:{id} · {n} bytes ·  |  | sha1:/sha256: prefix | "{n} lines · {size}" in the file header. The identifier is behind "Copy permalink". |
| `web/app.js:129` | Blame |  |  | Blame |
| `web/app.js:130` | Edit |  |  | Pencil icon; accessible name "Edit this file". |
| `web/app.js:69` | Binary file, {n} bytes. |  |  | Binary file not shown. With a "Download" action. |
| `web/app.js:193` | {path}: no such file |  |  | Not-found page: "This file does not exist on {branch}." |
| `web/app.js:500` | No repository named {name} on this device. |  | device | Not-found page: "This repository is not in this browser." Action: "Open by address". |

## Commits and diffs

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:487` |  committed on {yyyy-mm-dd} |  |  | "{author} committed {relative time}" |
| `web/app.js:488` | commit sha1:{id} |  | sha1:/sha256: prefix | "commit {short id}" with a copy button |
| `web/app.js:488` | tree  |  |  | Remove. "Browse files" opens the tree at this commit. |
| `web/app.js:489` |  · parent  |  |  | "{n} parent" followed by the short identifiers |
| `web/app.js:356, 490` | {n} changed file(s) |  |  | Showing {n} changed files with {a} additions and {d} deletions. |
| `web/app.js:322, 480` | added / removed / modified |  |  | File status icon; accessible names "Added", "Deleted", "Modified". |
| `web/app.js:186` | +{n} -{n} |  |  | +{n} −{n} with the five-square bar |
| `web/app.js:159` | Binary file. |  |  | Binary file not shown. |
| `web/app.js:162` | Large change ({n} lines before, {n} after) not shown. |  |  | Large diffs are not shown by default. Action: "Load diff". |
| `web/app.js:179` | ⋯ |  |  | Expand control; accessible name "Expand hidden lines". |

## Blame

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:208` | {n} version(s) across {n} commits on the first-parent line |  |  | Remove. |
| `web/app.js:209` |  (older history not examined) |  |  | Older history was not loaded. Action: "Load more". |
| `web/app.js:209` | Normal view |  |  | The Code / Blame switch above the file. |
| `web/app.js:196` | {path} is a binary file. |  |  | Blame is not available for binary files. |

## Editor

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:223` | File content |  |  | File contents |
| `web/app.js:225` | Commit message |  |  | Commit message |
| `web/app.js:225` | Update {file name} |  |  | Update {file name} |
| `web/app.js:226` | Your name |  |  | Not on this screen. Asked once at first run; changed in Settings → Profile. |
| `web/app.js:227` | Your email / you@example.org |  |  | Not on this screen. Settings → Profile. |
| `web/app.js:228` | The commit is made on this device and signed with this device's key. Nothing is sent anywhere. |  | device | Remove. After committing, the branch shows the "Not published" marker. |
| `web/app.js:240` | Commit to {branch} |  |  | Commit changes. With the choice "Commit directly to the {branch} branch". |
| `web/app.js:240` | Propose as a pull request |  |  | Propose changes. With the choice "Create a new branch for this commit and start a pull request". |
| `web/app.js:217` | Only a branch can be edited. |  |  | You are viewing a tag or a commit. Switch to a branch to edit this file. |
| `web/app.js:220` | {path} is a directory. |  |  | This is a folder. Open a file to edit it. |
| `web/app.js:222` | {path} is a binary file. |  |  | Binary files cannot be edited here. Use "Upload file" to replace it. |

## Resolve conflicts (web/app.js resolvePage)

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:279` | {n} conflict(s) to resolve |  |  | Resolve conflicts ({n} files) |
| `web/app.js:249` | There is no merge waiting. Fetch from the Commits page first. |  |  | There is nothing to resolve. |
| `web/app.js:251` | Nothing changes until you complete the merge. Leaving this page abandons it. |  |  | Remove. Leaving with unsaved edits asks "Discard your changes?". |
| `web/app.js:254` | Resolution of {path} |  |  | Resolve conflicts in {path} |
| `web/app.js:258` | Which version of {path} to keep |  |  | Which version of {path} to keep |
| `web/app.js:259` | Keep this device's version ({state}) |  | device | Keep your version |
| `web/app.js:260` | Take the replica's version ({state}) | **replica** |  | Keep the incoming version |
| `web/app.js:274` |  · here: {state} · on the replica: {state} | **replica** |  | yours: {state} · incoming: {state} |
| `web/app.js:275` | Edit to the text you want and remove the three marker lines. |  |  | Remove the conflict markers, then choose "Mark as resolved". |
| `web/app.js:268` | There are still conflicts. |  |  | {n} files still have conflicts. |
| `web/app.js:277` | Complete the merge |  |  | Commit merge |

## Pull requests

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:294` | No pull requests. Edit a file and choose "Propose as a pull request". |  |  | No pull requests yet. Action: "New pull request". |
| `web/app.js:292` | merged |  |  | Merged state icon and badge |
| `web/app.js:292` | open · {n} of {n} approvals |  |  | Open state icon; review summary "Approved" or "Review required". |
| `web/app.js:282` | {8 hex} (this device) (owner) |  | device | The person's name and avatar. "(this device)" becomes nothing, or "you"; "(owner)" becomes the "Owner" badge. |
| `web/app.js:301` | There is no pull request #{n}. |  |  | Not-found page: "This pull request does not exist." |
| `web/app.js:348` | Merged / Open |  |  | State badges "Merged" and "Open" (also "Closed" and "Draft"). |
| `web/app.js:348` |  · into {branch} · proposed by {key} on {date} |  |  | {name} wants to merge {n} commits into {base} from {head} |
| `web/app.js:349` | commit  |  |  | The Commits tab with its count. |
| `web/app.js:350` |  · behind {branch}: it must be brought up to date before it can merge |  |  | This branch is out-of-date with the base branch. |
| `web/app.js:351` | Approvals that count: {n} of {n} required. |  |  | Review required: at least {n} approving review(s). Or: "Changes approved: {n} approving review(s)". |
| `web/app.js:352` |  Approved by {names}. |  |  | {name} approved these changes (one timeline item each) |
| `web/app.js:352` |  Nobody has approved this commit. |  |  | Remove. "Review required" already says it. |
| `web/app.js:340` | , does not count: the proposer |  |  | Authors cannot approve their own pull request. |
| `web/app.js:330` | not defined on the branch, so it cannot pass |  |  | Required — not set up on {branch} |
| `web/app.js:331` | no result yet for this content |  |  | Expected — waiting for status to be reported |
| `web/app.js:332` | pass / fail |  |  | Passed / Failed. A result carried over from identical content reads "Passed (already checked)". |
| `web/app.js:332` |  (results under this key have differed: flaky) |  |  | Results have differed between runs. |
| `web/app.js:332` | , published by {key} on {date} |  |  | — {name}, {relative time} |
| `web/app.js:333` | {12 hex of the check key} |  |  | Remove. |
| `web/app.js:354` | A check is keyed by the content it reads. A result for the same content counts, whichever commit it was made for. |  |  | Remove. Tooltip on "Passed (already checked)": "This exact content was checked before." |
| `web/app.js:342` | Approve this commit |  |  | Approve (inside "Review changes", with Comment and Request changes) |
| `web/app.js:343` | Merge |  |  | Merge pull request |
| `web/app.js:344` | Bring up to date with {branch} |  |  | Update branch |
| `web/app.js:286, 299` | This repository's signed log does not verify: {reason} | **signed log** |  | This repository's history has been tampered with. Do not use it. Open it again from a remote you trust. |

## Sync, on the Commits page today (web/app.js branchTools)

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:417` | Download as git bundle |  |  | Download bundle (in the Code button's menu, beside "Download ZIP") |
| `web/app.js:415` |  {n} objects, {n} bytes. Fetch it with: git pull {file} {branch} |  | object | Remove. The download starts. |
| `web/app.js:418` | No signed records yet. | **record** |  | Remove. |
| `web/app.js:419` | {n} record(s) in this repository's signed log; signatures, chain and access all verified. | **record, signed log** |  | Remove. The Verified badge on commits carries this; details open on click. |
| `web/app.js:420` | This repository's signed log does NOT verify: {reason} | **signed log** |  | This repository's history has been tampered with. Do not use it. Open it again from a remote you trust. |
| `web/app.js:421` | Replica address | **replica** |  | Remote address |
| `web/app.js:421` | https://storage.example.org/project |  |  | https://storage.example.org/project |
| `web/app.js:432` | Push |  |  | Publish (first time) or Push |
| `web/app.js:448` | Fetch |  |  | Fetch |
| `web/app.js:425` |  pushing… |  |  | No text. The "Not published" marker stays until it finishes. |
| `web/app.js:435` |  fetching… |  |  | No text. A quiet progress mark on the Fetch button. |
| `web/app.js:429` |  The replica is already up to date. | **replica** |  | Everything is up to date. |
| `web/app.js:430` |  Pushed {n} objects and {n} signed update(s) in {n} ms. |  | object | Published. |
| `web/app.js:443` | Already up to date. |  |  | Already up to date. |
| `web/app.js:443` | Nothing new on the replica; {n} record(s) here not pushed yet. | **record, replica** |  | {n} changes not published yet. |
| `web/app.js:444` | Fetched and moved to the replica's head. | **replica** |  | Updated to the latest commit. |
| `web/app.js:444` | Fetched and merged with the changes made here. Push to publish the merge. |  |  | Merged the latest changes with yours. Push to share the merge. |
| `web/app.js:445` | Fetched; the changes made here were signed again on top. Push to publish them. |  |  | Moved your changes on top of the latest commit. Push to share them. |
| `web/app.js:456` | Storage keys |  |  | Storage keys (Settings → Storage) |
| `web/app.js:457` | Only needed for a store that requires signed requests. Kept in memory while this page is open; never stored, never sent. Each request carries a signature, not the secret. |  | store (noun) | Only needed if your storage asks for them. Kept until you close this tab. |
| `web/app.js:452` | Access key |  |  | Access key |
| `web/app.js:453` | Secret key |  |  | Secret key |
| `web/app.js:454` | Region |  |  | Region |
| `web/app.js:463` | Use these keys |  |  | Save keys |
| `web/app.js:455, 462` |  Keys are set for this address. |  |  | Storage keys saved for this tab. |
| `web/app.js:462` |  Keys cleared. |  |  | Storage keys removed. |

## Access and branch protection (web/app.js accessTools)

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/app.js:396` | Access |  |  | Two Settings pages: "Collaborators" and "Branches". |
| `web/app.js:364` | No signed records yet: the first change made here makes this device the owner. | **record** | device | Remove. |
| `web/app.js:365` | This device owns this repository. |  | device | You own this repository. |
| `web/app.js:366` | This device has a revoked grant. | **grant** | device, revoke | Your access to this repository was removed. |
| `web/app.js:366` | This device has {read\|write} access. |  | device | You have {Read\|Write} access. |
| `web/app.js:367` | This device has no access beyond reading. |  | device | You have Read access. |
| `web/app.js:361, 397` | This device's key |  | device | Sign-in key for this browser (Settings → Security) |
| `web/app.js:371` | {16 hex}… |  |  | The collaborator's name and avatar. |
| `web/app.js:372` | revoked |  | revoke | Removed (the row leaves the list) |
| `web/app.js:372, 378` | write / read |  |  | Role: Write / Read |
| `web/app.js:373` | until {date} |  |  | Expires {date} |
| `web/app.js:373` | no expiry |  |  | No expiration |
| `web/app.js:376` | Revoke |  | revoke | Remove |
| `web/app.js:377` | Key to grant access to | **grant** |  | Add a collaborator |
| `web/app.js:377` | Their device key (64 characters) |  | device | Their sign-in key |
| `web/app.js:378` | Access |  |  | Role |
| `web/app.js:379` | Days until it expires |  |  | Expiration |
| `web/app.js:379` | days (0 = no expiry) |  |  | Choices: 7 days, 30 days, 90 days, No expiration |
| `web/app.js:383` | Grant | **grant** |  | Add collaborator |
| `web/app.js:399` | A grant or revocation is a signed record. It takes effect for others once pushed. | **record, grant** | revoke | Remove. The "Not published" marker covers it. |
| `web/app.js:392` | {branch} is protected: it only moves forward, for {who}, with {n} approval(s) and the checks {names} required. |  |  | A rule row: "{branch}" with "Currently applies to 1 branch", and Edit and Delete. |
| `web/app.js:392` | {branch} is not protected: anyone with write access can rewind it. |  |  | Empty state: "No branch protection rules yet." Action: "Add rule". |
| `web/app.js:386` | Who may change the protected branch |  |  | Restrict who can push |
| `web/app.js:387` | anyone with write access |  |  | Anyone with Write access |
| `web/app.js:387` | the owner only |  |  | Only the owner |
| `web/app.js:393, 390` | approvals required: / Approvals required to change the branch |  |  | Required number of approvals before merging |
| `web/app.js:389` | Checks required to change the branch |  |  | Require status checks to pass before merging |
| `web/app.js:389` | required checks, e.g. engine,page | **engine** |  | Search for status checks |
| `web/app.js:394` | Protect |  |  | Create |
| `web/app.js:394` | Change |  |  | Save changes |
| `web/app.js:395` | Remove protection |  |  | Delete rule |

## Messages raised below the page and shown as errors

| Where | Shown today | Banned words in it | Other implementation words | Proposed wording |
|---|---|---|---|---|
| `web/engine.js:4-5, 26` | truncated / not a packfile / unsupported pack version / pack checksum mismatch / unknown entry type / bad compressed data / bad delta / missing delta base / malformed object / engine error {n} | **engine** | object | This repository could not be read. The download is incomplete or damaged. Try again. |
| `web/git.js:14` | {address}: {status} |  |  | Could not reach {host} ({status}). Check the address and your connection. |
| `web/git.js:49, 52` | fetching {pack} / verifying {pack} |  |  | No text. Progress on the button. |
| `web/git.js:67; web/replica.js:174, 215` | replica is missing object {id} | **replica** | object | This remote is incomplete. Some files are missing. Try another remote. |
| `web/git.js:71` | replica served different bytes for {id} | **replica** |  | The remote sent data that does not match what was asked for. Nothing was saved. Try another remote. |
| `web/replica.js:176, 217` | refused: the replica served different bytes for {id} | **replica** |  | The remote sent data that does not match what was asked for. Nothing was saved. Try another remote. |
| `web/git.js:93` | unknown ref {name} |  |  | Not-found page: "The branch or tag {name} does not exist." |
| `web/git.js:98` | {name} does not name a commit |  |  | Not-found page: "{name} is not a commit, branch or tag." |
| `web/git.js:111` | {path}: not a directory |  |  | Not-found page: "This path does not exist on {branch}." |
| `web/git.js:113` | {path}: no such file |  |  | Not-found page: "This file does not exist on {branch}." |
| `web/git.js:198` | this directory has a file name that is not UTF-8; editing it is not supported yet |  |  | A file name in this folder cannot be shown, so files here cannot be edited in the browser. |
| `web/git.js:203` | {name} is a directory |  |  | A folder named {name} already exists here. |
| `web/git.js:206` | {name} is a file |  |  | A file named {name} already exists here. |
| `web/git.js:218, 258, 267` | {name} is not a branch |  |  | The branch {name} does not exist. |
| `web/git.js:219, 268` | a name and an email are needed to commit |  |  | Add your name and email in Settings → Profile to commit. |
| `web/git.js:220, 269` | a commit message is needed |  |  | Field error under the message box: "Commit message can't be blank". |
| `web/git.js:225, 274` | nothing changed |  |  | The Commit button is disabled until the file changes. No message. |
| `web/git.js:288` | already merged |  |  | This pull request is already merged. |
| `web/git.js:289` | this pull request is behind the branch; bring it up to date first |  |  | This branch is out-of-date with the base branch. Action: "Update branch". |
| `web/sync.js:196` | this pull request is already up to date |  |  | This branch is already up to date. |
| `web/sync.js:201` | it conflicts with the branch in: {paths} |  |  | This branch has conflicts that must be resolved. Action: "Resolve conflicts". Then the file list. |
| `web/sync.js:97` | conflict markers are still in {path} |  |  | {path} still contains conflict markers. |
| `web/sync.js:116` | a name and an email are needed for the merge commit |  |  | Add your name and email in Settings → Profile to merge. |
| `web/sync.js:128; web/replica.js:162` | the replica has nothing on this branch / the replica has no branches | **replica** |  | This remote has no commits on {branch} yet. |
| `web/sync.js:132; web/replica.js:159` | refused: the replica names a head its signed log does not lead to | **signed log, replica** |  | This repository's history has been tampered with. Do not use it. Open it again from a remote you trust. |
| `web/sync.js:133` | the replica changed again since these conflicts were shown; fetch and resolve again | **replica** |  | New commits arrived while you were resolving. Fetch again to continue. |
| `web/sync.js:138` | refused: the replica holds a different repository | **replica** |  | This remote holds a different repository. Check the address. |
| `web/sync.js:148` | refused: this clone has changes that are not in the replica's history | **replica** |  | Your copy and the remote have diverged in a way that cannot be merged here. Open the repository again from the remote. |
| `web/sync.js:157` | refused: unpushed records here were signed by another device | **record** | device | This browser holds unpublished changes made with another sign-in key. Publish them from that browser first. |
| `web/replica.js:39` | the store refused the request: the keys are wrong or lack permission |  | store (noun) | Your storage rejected the request. Check your storage keys and their permissions. |
| `web/replica.js:39` | the store refused the request: it needs keys |  | store (noun) | This storage needs keys. Add them in Settings → Storage. |
| `web/replica.js:50` | replica: {status} | **replica** |  | Could not reach the remote ({status}). |
| `web/replica.js:52` | not a holo-git replica | **holo, replica** |  | This address is not a {product name} repository. |
| `web/replica.js:60, 62, 64` | replica log is malformed / replica is missing log record {id} / refused: a log record does not match its digest | **record, replica, digest** |  | This repository's history has been tampered with. Do not use it. Open it again from a remote you trust. |
| `web/replica.js:108` | nothing to push: no change has been made to a branch yet |  |  | Everything is up to date. |
| `web/replica.js:109` | pushing a repository with changes on several branches is not supported yet |  |  | Only one branch can be pushed at a time for now. Push {branch} first. |
| `web/replica.js:118` | refused: the replica has changes this device does not have; clone it again before pushing | **replica** | device | The remote has commits you do not have. Fetch first, then push. |
| `web/replica.js:135, 142, 148` | replica refused object {id}: {status} / replica refused a log record: {status} / replica refused the new head: {status} | **record, replica** | object | The remote rejected the push ({status}). Check your storage keys and try again. |
| `web/replica.js:138, 180, 220` | sent {n} of {n} objects / fetched {n} objects |  | object | No text. Progress on the button. |
| `web/replica.js:147` | refused: the replica changed while pushing; clone it again and retry | **replica** |  | Someone else pushed at the same time. Fetch, then push again. |
| `web/store.js:49` | object {id} is not in the store |  | object, store (noun) | Part of this repository is missing from this browser. Fetch from its remote. |
| `web/store.js:54` | object {id} refused: stored bytes do not match their label | **label** | object | A stored file is damaged and was not shown. Fetch from the remote to repair it. |
| `web/store.js:104` | refused: the ref changed since this update was prepared |  |  | This branch changed in another tab. Reload and try again. |
| `web/identity.js:42` | refused: not a fast-forward of the current ref |  |  | This branch is protected. Open a pull request. |
| `web/identity.js:51` | a key is 64 hexadecimal characters |  |  | Field error: "That is not a valid sign-in key." |
| `web/identity.js:52` | access can be read or write |  |  | Not reachable from a menu of two roles. Remove. |
| `web/identity.js:53` | that is this device's own key |  | device | Field error: "That is your own key. You already have access." |
| `web/identity.js:78` | a protected branch is open to writers or to the owner only |  |  | Not reachable from a menu. Remove. |
| `web/identity.js:79` | required approvals must be a whole number from 0 to 200 |  |  | Field error: "Enter a whole number from 0 to 200." |
| `web/identity.js:80` | a check name is lower-case letters, digits and hyphens |  |  | Field error: "Check names use lowercase letters, numbers and hyphens." |
| `web/identity.js:95` | a pull request needs a title |  |  | Field error: "Title can't be blank". |
| `web/log.js:38, 39, 40, 89, 94, 101, 103, 107, 116, 119` | refused: unknown record type in the log / a record signed for another repository is in the log / the log chain is broken / the log skips a ref value / a malformed grant, protection, pull request or check result in the log / an approval of no pull request is in the log | **record, grant** |  | This repository's history has been tampered with. Do not use it. Open it again from a remote you trust. |
| `web/log.js:58, 73` | refused: cannot check that a protected branch only moved forward / cannot work out which checks a protected branch needed |  |  | This repository's history could not be fully verified because part of it is missing. Fetch from its remote and try again. |
| `web/log.js:86` | refused by the kernel: a {kind} by key {id} does not count | **kernel** |  | The plain reason, by kind. Push: "This branch is protected. Open a pull request." Merge: "Merging is blocked: {missing reviews or checks}." Other: "You don't have permission to do that." |
| `web/records.js:36, 37` | unknown record type / a record field is missing or contains a line break | **record** |  | Field error naming the field: "{Field} can't contain a line break." |
| `web/kernel.js:11` | the kernel must import nothing | **kernel** |  | Full-page error: "This copy of {product name} is damaged and will not run. Reload; if it persists, clear this site's data." |
| `web/checks.js:30-75` | checks file: {13 messages: bad path, bad name, defined twice, nothing to run, lists no inputs, bad tool, bad environment variable, uses an unknown check, uses a check with no outputs, uses itself, expected { "checks": [...] }} |  |  | The checks file has an error: {what}. Fix `checks.json` and try again. |
| `web/checks.js:99` | the key of {check} needs what {other} produced |  |  | Waiting for {other} to finish. |
