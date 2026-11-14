# holo-git

A serverless code-hosting application that runs entirely in the browser, built as a Prism application.

Live page: https://humuhumu33.github.io/holo-git/ . Press Clone and it clones this repository from a static replica published beside it.
Gitea is the reference for features. LexLean specifies the rules and Lean proves them. Storage is content-addressed with kappa labels.

Status: Phase 1 complete, with the gaps listed below. Phase 2 works in the browser: clone, browse, diff, blame, offline. Self-hosting has begun; see below. Phase 3: commit in the browser, push to a writable replica, clone it back, fetch and merge, grant and revoke access, export to git. The holo builds on GitHub Actions and replays 16 of 16 acceptance vectors. It rates P0: it does not yet carry provenance, proof or replay statements inside it.

## What is proved today

Lean checks 25 theorems in `src/`. Each rule lives in one module and its theorems in a `Proofs` module beside it.

- Authorization (`Access`): an unsigned, revoked or expired operation never counts; no grant cannot read; owner permits everything; access is reflexive and transitive.
- Delegation (`Delegation`): a revoked or unsigned link is invalid; any dead link kills a chain of five; an invalid chain grants nothing; a chain never widens access and never exceeds its cap.
- Addressing (`Address`): the restore decision is true exactly when the claimed and observed labels match.
- Operation order (`OpLog`): the order is irreflexive, asymmetric and transitive.

The kernel (`Kernel`) answers four operations: authorize, order, delegation chain, restore.

## What is not proved

- Expiry is two lemmas (an expired link has rank zero; rank zero is invalid), not one statement.
- That a chain stays within every single link's scope is proved for two modes, not for five links.
- The byte decoding in `Kernel` is tested by acceptance vectors, not proved.
- A passkey binding is modelled as the first link of a chain. Checking the passkey signature itself is the host's job and is outside the proofs.

## Building

`build --check` and `verify --lean` run locally or on the hosted verifier. The full build runs on GitHub Actions:

```bash
npx prism-code@latest build --remote github
```

On the development machine the full local build timed out and then took the container host down, so it is not the supported path yet.

## The browser read path

`engine/` is the git engine in Rust: object hashing, packfile reading, delta resolution, commit and tree parsing, line diff and blame. It compiles to 112 KB of WebAssembly with no imports. `web/` is the page.

What works, tested in a browser:

- Clone from any static replica that serves a bare repository as files. No server-side git.
- Every object's identifier is computed from its bytes; nothing is taken from the replica's index.
- Objects are stored on the device under kappa labels (`sha1:<id>`) as loose-object bytes, the form a kappa peer stores.
- Every read re-derives the label. Altered bytes are refused.
- Browse files, view a file, list history.
- Line diffs on each commit, with context, computed by a minimal Myers diff in the engine.
- Blame for any file, following the first-parent line. Commits that left the file's label unchanged are skipped without reading it.

- The page is pinned. A service worker holds the SHA-256 of each of the page's eight files and serves only bytes that match. The footer shows one digest naming the whole page; each deploy prints the same digest in its run summary.
- A new version never takes over silently: the page shows its digest and waits for the visitor to accept it.
- Offline: once loaded, the page and every cloned repository work with no network.

What is tested: engine tests run against git itself.

- Every object in a real packfile matches `git cat-file`, byte for byte, and damaged packs are refused.
- 66 diff cases rebuild the new file exactly and are as short as `git diff --minimal`.
- Blame names the same commit as `git blame` on every line of a 25-commit history.

The page was exercised by hand against a replica of this repository: the object count matches git, the added and removed line counts match `git show --numstat` for 27 files in three commits, and the README's blame matches `git blame`.

Not done yet: rename detection (a rename shows as a removal and an addition), blame through merges, markdown rendering, partial clone, and large repositories (a pack is held in memory whole). Diffs with more than 2,000 differing lines fall back to a full replacement. Storage is IndexedDB, not the file store the architecture proposes. The pin does not protect the first visit, and a visitor who accepts a new version without comparing digests is trusting the host again.

```bash
(cd engine && cargo test --release)
sh scripts/build-web.sh
python -m http.server 8731 --directory web
```

## The write path

First slice of Phase 3. A commit can be made in the browser and taken to any git.

- Edit a file on a branch and commit. The engine serialises the blob, the trees on the file's path and the commit, and gives them the identifiers git would. Every other subtree is reused by its identifier, unread.
- The proved kernel is in the page. `web/kernel.wasm` is the 2.5 KB guest built from `src/`; it imports nothing. Every object read asks it whether the label matches (the restore decision), and every ref update asks it whether the update counts (the authorize decision). The footer counts the decisions.
- Ref updates are signed. Each device generates a non-extractable ECDSA P-256 key. A ref moves only as a signed record that names the previous record's digest; the signature is checked, the kernel is asked, and the ref and its log entry change in one transaction, only if the ref still holds the value the update was signed against.
- Download a branch as a git bundle. `git pull repo-main.bundle main` fetches it.

What is tested: three more engine tests against git, eleven in all. Written blobs, trees and commits get git's identifiers; malformed trees and commits are refused; `git index-pack --strict` accepts our pack; git verifies, clones and `fsck --strict`s our bundle.

Checked by hand in the browser: a commit made in the page was exported as a bundle and pulled, fast-forward, into the repository it was cloned from by real git, with a clean `git fsck --strict`. The kernel refused an unsigned update, a revoked one, and a write with only read access. A tampered log entry made the log fail verification.

Not done yet, and it matters:

- The device key is the only identity. It is not bound to a passkey or a person, and it is not the kappa anchor form. Clearing site data destroys it.
- The fast-forward check is in the host, not in the kernel.
- One file per commit, text only, on an existing branch. No new branches, deletes, renames or merges.
- The kernel guest is a committed build output. `scripts/build-web.sh` checks its SHA-256 against `scripts/kernel.sha256`, but the Pages build does not rebuild it from the model.

The kernel guest in the page is recorded under Grants below.

## Push and writable replicas

A writable replica is plain object storage: GET and PUT by path, and a conditional PUT for the one small document that names the current heads. Any store with those two things can serve. The replica is never trusted.

- Layout: `objects/sha1/<2 hex>/<38 hex>` holds each git object as its loose-object bytes; `log/<sha256>.json` holds each signed ref update, named by its own digest; `state.json` names each branch's head and latest log record.
- Push sends only objects the replica cannot already have, then the new log records, then moves the head with a conditional write, so a concurrent push loses cleanly.
- Clone from a replica walks the signed log first. Every record must hash to its name, verify, chain to the one before, and be allowed by the kernel; the head must be where the log leads. Then objects are fetched and each checked against its label.
- The first signer of a repository's log owns it. Other keys' updates count only under a grant; see Grants.

`scripts/dev-replica.mjs` is a stand-in object store for development: about 60 lines, no knowledge of git or signatures, no authentication. `scripts/replica-to-git.py` turns a replica's files into a git repository so git can check them.

Checked by hand in the browser against the stand-in, across origins:

- First push: 13 objects and one signed update. Git rebuilt from the replica's files passes `fsck --strict` and shows the browser's commit.
- Second push sent 3 objects, not 16. Pushing again reported up to date.
- Clone back into an empty store: history, files and log all verify.
- Refused: an altered object, an altered log record, and a head the log does not lead to.
- A second device (a different key) was refused by the kernel when it tried to commit; the owner then committed and pushed.
- The stand-in answers 412 to a stale or duplicate conditional write.

Limits:

- A replica that serves an older, validly signed state is accepted by a fresh clone. This was tested and it happened. Detecting it needs a second replica or a head learned some other way.
- The stand-in store has no authentication. Against a real store the adapter signs its requests with keys; see Against a real object store.
- Tried against one real S3-compatible store, not against a cloud provider; see Against a real object store.
- One request per object, in both directions. Fine for small repositories, slow for large ones; packs are not used for transfer yet.
- One branch per repository can be pushed. A repository that has never been changed on this device has no signed log and cannot be pushed.

### Against a real object store

The adapter now signs its requests (AWS Signature Version 4, with the browser's own cryptography) and has been run against a real S3-compatible store that checks every signature: SeaweedFS, from its official image, pinned by digest.

- `web/s3sign.js` signs; `scripts/dev-s3.sh` starts the store with throwaway keys; `scripts/probe-s3.mjs` asks a store the questions the adapter depends on and prints the answers.
- Keys are typed into the Storage keys panel. They are held in memory while the page is open, never written to storage, and never sent: each request carries a signature made with the secret.
- What the probe found on SeaweedFS: a missing object is a 404; `If-None-Match: *` on an existing object and `If-Match` with a stale ETag both answer 412; the right ETag is accepted; a wrong secret and an unsigned request are refused with 403; cross-origin preflights are answered and the ETag is exposed to the page.

Tested, in `test/s3.test.mjs`, on every push in CI: refusal without keys and with wrong keys; push, clone back on another device, and git's `fsck` on the result; two writers racing for the head, where the store lets exactly one through and the loser's retry succeeds; and grant, fetch and merge between two devices through the store. In a browser, by hand, from a different origin: refused without keys, two pushes with keys, a fetch, and the secret absent from browser storage afterwards.

What this does not show:

- AWS S3 and Cloudflare R2 themselves. SeaweedFS speaks the same protocol and checks signatures, but each provider has its own rules for cross-origin access, conditional writes and bucket addressing. Run `scripts/probe-s3.mjs` against a provider before relying on it.
- Only path-style addresses (`https://host/bucket/prefix`) were used.
- Reads need keys too unless the bucket is public. There is no way yet to give someone read access without giving them keys to the store.
- Whoever holds the store's keys can delete or overwrite anything in it. The signed log means they cannot forge history, only destroy availability.

## Grants

The owner of a repository can give another device's key read or write access, with an expiry, and take it back.

- A grant and a revocation are signed records in the same chain as changes. Everyone folds the same log and reaches the same heads and the same grants, whoever stored it.
- One kernel decision covers every record: given the signature check and the issuer's grant as it stood at that point in the log, does this record count? A change needs write; a grant or revocation needs admin, which only the owner has.
- The kernel takes the grant's expiry and the record's time as 8-byte values and compares them itself.
- A record signed for one repository is refused in another's log.
- The Access panel on the Commits page shows this device's key, the grants, and the controls.

The kernel guest now in the page is recorded under Protected branches.

Checked by hand in the browser, with two keys standing in for two devices and the stand-in store between them:

- Alice committed, granted Bob write for 30 days and pushed. Bob cloned, committed and pushed. Alice cloned and saw Bob's commit; the log verified.
- Bob tried to grant access himself: refused by the kernel.
- Alice revoked Bob and pushed. Bob cloned and tried to commit: refused by the kernel.
- A 20-second grant: Bob's commit at 4 seconds was accepted, at 27 seconds refused.
- A forged record: Bob's key signed a change after revocation and it was written straight to the store, bypassing the page. The signature was valid and the store accepted it. A clone refused the whole log.
- Git rebuilt from the final replica passes `fsck --strict`.

Limits:

- Expiry trusts the signer's clock. A record carries the time its signer claims, so a holder of an expired grant can backdate a change. Revocation does not have this weakness. Closing it needs a time the signer cannot choose.
- A revoked or expired key can still write junk to an open store and make the log fail to verify for everyone until the head document is put back. That is an attack on availability, not on integrity.
- Only the owner can grant. Read and write only; no admin grants, no chains of grants, though the kernel decides chains of up to five links.
- Read access is not enforced: nothing is encrypted, so anyone who can reach the replica can read it. A read grant is a statement, not a barrier.
- A grant names a device key, not a person. There is no key-to-identity binding yet.
- Two people pushing at once: the second is told to fetch; see Fetch and merge.
- The proofs cover the access rules. Assembling the request (reading the log, checking signatures, choosing which grant applies) is page code, tested by hand only.

## Self-hosting: what has been done, and what has not

On 2026-11-14 this repository was developed through itself for three changes, on one machine.

What was done:

- Its history (437 objects) was published from the git checkout to a SeaweedFS store with signed requests, in under six seconds.
- Its `main` was protected with its own three checks: `engine`, `page` and `model`.
- A direct publish to `main` was then refused by the kernel, and a pull request could not merge before its checks had results.
- A runner ran the three checks for the first pull request and published signed results: 7 minutes 4 seconds, everything built from nothing.
- The second and third pull requests changed only documentation. No check ran for them: the results were found in the signed log under the same keys. The runner took 3.8 seconds to establish that, and the merges went straight through.
- The page, in a browser, cloned the repository from the store in 7.6 seconds (444 objects, one request each), verified its log, and showed the protection and the merged pull requests.
- The result was fetched back into git and pushed to GitHub, which is now a mirror of what was merged there.

What this is not:

- **Not durable.** The store was a container on a development machine with throwaway keys. It is gone. Hosting this repository for real needs a store that stays up and keys that someone holds.
- **Not public.** Nobody else could reach it. The live page is still built and served by GitHub.
- **Not independent of GitHub.** The page is deployed by a GitHub workflow from the GitHub mirror, and the proved kernel is built there too.
- **One person.** The owner proposed, the owner's runner checked, and the owner merged. No approvals were required, so no second person's judgement was involved.
- **Seven minutes is slower than the CI it would replace** for a first run, because the runner builds each check in a fresh directory. The gain is entirely in the runs that then do not happen.

## Working from a git checkout

Commits are still made with git. `scripts/holo.mjs` carries them to a replica as signed updates and brings others' work back. It runs the page's own modules in Node, so the engine, the kernel and the fold over the signed log are the same code a browser runs; only storage (in memory) and the key (a file) differ.

```bash
node scripts/holo.mjs key                              # this machine's key, to be granted access
node scripts/holo.mjs publish --replica URL            # move the branch to HEAD, fast-forward only
node scripts/holo.mjs propose --replica URL            # offer HEAD as a pull request
node scripts/holo.mjs status  --replica URL
node scripts/holo.mjs approve --replica URL --pull N
node scripts/holo.mjs merge   --replica URL --pull N
node scripts/holo.mjs protect --replica URL --checks engine,page,model --approvals 1
node scripts/holo.mjs grant   --replica URL --to KEY
node scripts/holo.mjs fetch   --replica URL            # into refs/holo/<branch>, checked by git
node scripts/runner.mjs run   --replica URL            # run required checks that have no result
```

Every git object is rebuilt by the engine on the way in and must come out with the identifier git gave it. On the way back, history is handed to git as a bundle, and git checks every object itself.

Tested in `test/holo.test.mjs`, four tests against real git: a published history that a browser-side clone and `git fsck` both accept; an incremental publish; a refusal for a history that does not descend and for someone without access; and propose, approve, merge and fetch back into git.

Limits: the key is a file on disk, readable by anything that can read the file; each command clones the replica into memory first, one request per object; one branch; no tags.

## Checks keyed by content

A check is named by what it reads, not by when it ran. This is the part of the project aimed at waiting.

- `.holo/checks.json` lists each check: what to run and which paths it reads.
- A check's action key is a digest of its definition and of the content labels of those paths in one tree. Git already labels every directory by its content, so the key costs nothing to compute.
- A result is stored under its key. If a result is there, the check does not run. A rebase, a merge of tested content, a revert to something that passed, or a change to a file the check does not read all have a key that is already answered.
- A protected branch can require checks by name. The merge gate counts a required check as met when a passing result exists under the exact key the proposed change needs, published by someone who can write. The kernel proves that a missing check never merges.
- The definitions are read from the branch as it stands, never from the proposed change, so a change cannot weaken the check it must pass.
- A later result under the same key replaces an earlier one, and the key is marked as having differed: that is what a flaky check looks like here.

Three pieces:

- `node scripts/check.mjs run` works in any git checkout and keeps results on disk. It is what this repository's CI now runs.
- `node scripts/runner.mjs run --replica URL` is a runner for a holo-git replica: it fetches each open pull request, runs only the required checks with no result, and publishes signed results. Anyone with write access can run one, anywhere. There is no queue.
- The pull request page shows each required check, its key, and whether a result exists.

Measured on this repository:

- Running all three checks from nothing took 250 seconds. Running them again with nothing changed took 1.4 seconds.
- Replaying the 26 commits to that point with today's definitions: 78 check runs if every check runs on every commit, 30 with reuse. 62 percent avoided, about 2.6 times fewer.
- That is far from 100 times. This history is short and most of its commits changed code that a check reads. The figure will be higher where changes are small against a large codebase, and it should be measured there, not assumed.

Tested in `test/checks.test.mjs`, fifteen tests: the key ignores paths a check does not read; a required check blocks a merge until its result exists; a change touching nothing the check reads merges on the earlier result with nothing run; a failure does not count and a later pass marks the key; a change cannot weaken its own check; a result from someone since revoked stops counting; a check the branch does not define cannot be met; a forged merge without the check is refused by every clone; the runner end to end; the command in a plain git checkout, including a revert that runs nothing; an undeclared input failing; an unnamed environment variable withheld; a missing tool or variable skipping the check; and a stored result not reused once a tool changes.

What a check can depend on is now what its key covers:

- **Inputs.** A check runs in a directory holding only the paths it declared, as committed. A check that reads a file it did not declare fails there, instead of passing and being wrongly reused later. Running this repository's own checks that way confirmed their declarations: the engine tests and all the page tests pass with nothing else present.
- **Tools.** A definition names each tool it relies on and the start of what that tool prints, such as `cargo 1.`. That expectation is in the key. A machine whose tool prints something else does not run the check at all, and a result stored on disk is reused only while the tools print exactly what they printed when it was made.
- **Environment.** A check gets a small fixed set of variables and those it named, nothing else. A check that needs a variable this machine lacks is skipped here, not failed. The page tests and the tests against a real store are now two checks, `page` and `store`, because they differ in what they need.

What remains open:

- **It is not a sandbox.** A check can still read outside its directory on purpose, use the network and read the clock. The accidental cases are closed, not the deliberate ones. A nondeterministic check is still cached as if it were not.
- **A failure caused by the machine is stored like any other.** A full disk or a network outage looks the same as a broken test. `--retry` runs stored failures again. This bit during development: the first isolated run failed because Windows limits path length, and the failure was cached until removed.
- **Tool expectations are prefixes chosen by the author.** `cargo 1.` accepts every 1.x compiler. Tighter is safer and reused less.
- **Directories kept between runs are not in the key.** Build output and downloaded packages are kept for speed, on the assumption that they never change a result.
- **Trust is coarse.** Any key with write access can publish a result. There is no separate list of trusted runners and no requirement that two runners agree.
- **Checks run whole.** One changed test file reruns every test in that check.
- **Isolation costs time.** Each check builds in its own directory, so a first run is slower than building in place.
- **Results in CI live in GitHub's cache**, which expires and is not shared with anyone's own machine.

## Pull requests and the merge gate

A thin first version: only what approvals and checks need to attach to.

- A pull request is a signed record proposing one commit for a branch. It moves nothing. In the editor, "Propose as a pull request" makes the commit and the record.
- An approval is a signed record for one exact commit on one branch. It says nothing about any other commit, so bringing a pull request up to date, which makes a new commit, needs a new approval.
- Merging moves the branch to exactly the proposed commit. No merge commit is made at merge time, so nothing unreviewed can ride along. A pull request that is behind the branch must be brought up to date first.
- A protected branch can require a number of approvals. Then nobody commits to it directly, the owner included.
- An approval counts only if it comes from someone other than the proposer who can still write at the moment of the merge.
- A pull request's number is its place among pull requests in the signed log, which everyone folds the same way. Numbers need no server.

Proved in the kernel, for any evidence: fewer approvals than required never merges, and fewer checks than required never merges. Counting the approvals that qualify is page code; the kernel proves what follows from the count.

Kernel guest: SHA-256 `c61abc2421a4151dfa2a3906caec28ed28a8762b67463074b9aaf264750de625`, from commit `854e248`, run https://github.com/humuhumu33/holo-git/actions/runs/43552793784, holo fingerprint `blake3:6b571f3f916a737b9f929c396d384549132c1996f96212c1c36664b20c9df0d8`, 44 of 44 acceptance vectors. The model has 31 theorems in 16 modules.

Tested in `test/pulls.test.mjs`, eight tests among three devices: a proposal travels without moving the branch; no direct commits where approvals are required; a self-approval does not count; an approval does not carry to an updated commit; an approval from someone since revoked stops counting; a merge without approvals, signed by a writer and written straight to the store, is refused by every clone; a fresh clone reaches the same numbers and states and git's `fsck` accepts the repository. By hand in the browser: propose, list, view with diff, self-approve, and the refusals of merge and direct commit.

Not done:

- No discussion: no comments, no review of individual lines, no closing a pull request without merging.
- One commit per proposal from the editor; a pull request is one commit, not a branch that grows.
- Bringing up to date stops at a conflict; the resolve screen is not wired to it.
- The refusal message names the kernel, not the reason. It should say how many approvals are missing.
- A pull request needs its proposer to be able to write to the store, since the commit must be uploaded. Proposing from a fork does not exist.
- "Approvals do not permit a rewind" could not be proved as one statement; the rewind rule is proved in `Protect` and an acceptance vector covers the combination.

## Protected branches

The owner can protect a branch. It then only moves forward, and only for those the rule names: anyone with write access, or the owner alone.

- Proved in the kernel, for any evidence: a rewind of a protected branch is refused, whoever signs it, and an unsigned update never moves a ref. The owner is not exempt.
- Protection and its removal are signed records in the log, like grants. Only the owner can issue them.
- Whether a branch "only moved forward" is evidence the page computes by walking commit history. The kernel proves what follows from that evidence, not the evidence itself. Unknown is never treated as yes.
- A clone judges the log twice: once to learn what to fetch, then strictly once the history is there. It also fetches commits a protected branch passed through that a later rewind left unreachable, so that every protected move can be checked.
- An unprotected branch can be rewound by anyone with write access, as in git. A test records this.

The kernel guest now in the page is recorded under Pull requests and the merge gate. This section's rules were first built into the guest from commit `cf72707`.

Tested in `test/protect.test.mjs`, ten tests: only the owner can protect or unprotect; a writer still moves a protected branch forward; a rewind signed by a key with write access and written straight to the store is refused by every clone; the owner cannot rewind either; a merge counts as moving forward; an owner-only branch refuses a writer; removal restores access.

Not done: protected tags; patterns such as `release/*`; and deleting a branch, which does not exist at all yet.

## Fetch and merge

Two people can now work on one replica without cloning again. Fetch brings a clone up to the replica; if both sides changed, it merges.

- The replica's log stands. This device's unpushed records are signed again on top of it: its commits become one merge commit, its grants and revocations are issued again. Nothing already published is rewritten.
- Every re-signed record goes through the same fold and the same kernel decision as any other. A device whose access was withdrawn in the meantime cannot merge its work in.
- Trees are merged by identifier: identical subtrees are never opened. A file both sides changed is merged line by line in the engine.
- The merge rule is the cautious one. A line both sides kept is an anchor; between anchors, one side's change is taken, the same change on both sides is taken, and anything else is a conflict. Changes to adjacent lines conflict, as in git.
- A conflict changes nothing here: the branch and the log stay as they were, and the conflicting paths are listed.

What is tested:

- The engine's merge against `git merge-file` on 600 random cases: whenever the engine calls a merge clean, git does too, with the same bytes. The two agreed every time (551 clean, 49 conflicts).
- Eleven page tests between two devices: fast-forward, different files, different parts of one file, the same line, the same file added identically and differently, an unpushed grant issued again, and a device revoked in the meantime. Each clean merge's tree is exactly the tree `git merge-tree` writes for the same two commits, and git's `fsck` accepts the replica afterwards.

Limits:

- The resolve screen is a plain text box. No side-by-side view, no per-region buttons, and a merge in progress is not saved if the page is closed.
- A file whose kind changed on one side (file to directory) keeps this device's version unless the replica's is chosen whole. Renames are not followed.
- With criss-cross history there can be several merge bases; the newest is used, where git would merge them first.
- The merge commit is a plain commit with two parents. No rebase, no squash.
- Fetch reads one request per object, like clone.

### Resolving conflicts

When a fetch finds a conflict, the page opens a resolve screen instead of stopping.

- A text conflict is shown as git shows it: both sides between `<<<<<<< ours`, `=======` and `>>>>>>> theirs`. Edit to the text you want and remove the markers.
- A conflict with no common text to edit (the same new path added differently, a file deleted on one side and changed on the other, a binary file) is a choice between this device's version and the replica's.
- Completing the merge writes one merge commit whose message lists the paths that were resolved. Markers left in are refused. Until then nothing has changed, and leaving the screen abandons the merge.
- Resolutions are tied to the replica state they were made against. If the replica moves again first, they are refused and the conflicts are shown afresh.

Tested: the engine's marked output is byte for byte what `git merge-file` prints on all 49 conflicts among 600 random cases, and taking either side everywhere gives what `git merge-file --ours` and `--theirs` give. Three page tests cover resolving by editing, by choosing a side, markers left in, a resolution for the wrong path, and the replica moving in between. I also resolved one conflict by hand in the browser.

## Automated tests

Every push runs the checks that have no result for its content before anything is deployed. A failure stops the deploy. The checks are the suites below, split by what they need, and Lean's verification of the model.

- `engine/tests`: fourteen tests of the engine against git (objects, packs, deltas, diff, blame, merge, written objects, packs and bundles).
- `test/page.test.mjs`, `test/merge.test.mjs`, `test/s3.test.mjs`, `test/protect.test.mjs`, `test/pulls.test.mjs`, `test/checks.test.mjs` and `test/holo.test.mjs`: sixty-seven tests of the page's own modules (four of them against a real S3-compatible store), run in Node unchanged. Only browser storage is replaced, by an in-memory IndexedDB, one per "device". They use a real git repository, a static file server as a read-only replica, and the stand-in object store as a writable one.

What the page tests cover: clone matches git object for object; history, changed paths and line counts match `git show --numstat`; blame matches `git blame`; altered stored bytes are refused; a commit made here is pulled and `fsck`ed by git; push sends only what is missing and git accepts what the replica holds; a tampered object, log record or head is refused; grant, use, escalation, revocation and expiry between two devices; a validly signed forgery written straight to the store; a broken chain and a record from another repository.

One test records a known limit instead of a guarantee: a replica rolled back to an older signed state is accepted. It will fail when that is fixed, as a reminder to update this file.

The tests were checked for teeth: with the label check disabled eight of them fail, and with the kernel's decision ignored five fail.

Not covered: the interface itself (`app.js`), the service worker and the update prompt, and real browsers. Those are still checked by hand. The tests run under Node, whose storage and cryptography are not the browser's.

```bash
(cd engine && cargo test --release)
sh scripts/build-web.sh
npm ci && npm test
```

## Read next

- `docs/STUDY.md`: what the sources actually say.
- `docs/ARCHITECTURE.md`: the design.
- `docs/PARITY.md`: every Gitea feature and its status here.
- `docs/THREAT-MODEL.md`: what is defended and what is not.
- `docs/ROADMAP.md`: what comes next and why, and the open issues met with LexLean and Prism.
- `docs/PROMPT.md`: the original brief. Where it disagrees with the study, the study is right.
