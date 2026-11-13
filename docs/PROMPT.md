# Build prompt: a serverless GitHub alternative as a Prism application

## Mission

Build a code-hosting application that feels like GitHub, runs entirely in the browser, and has no application server.
Gitea (github.com/go-gitea/gitea, MIT) is the reference for features, data model and behaviour.
Prism SDK is the build system, LexLean is the specification language, and UOR content addressing with the kappa registry is the storage and trust layer.
The result is a `.holo` plus a static page, in a new repository under github.com/humuhumu33.

## Read before designing

Do not design from memory. Read these first and record what you found in `docs/STUDY.md`.

1. Gitea: `models/` (data model), `routers/web/web.go` (URL map), `routers/api/v1` and `templates/swagger` (API), `models/perm` and `models/unit` (permissions), `services/pull`, `services/issue`, `modules/git`, `web_src` (frontend). Use docs.gitea.com for the feature list.
2. kappa-registry (github.com/UOR-Foundation/kappa-registry): `README.md`, `CLAUDE.md`, `AGENTS.md`, `crates/kappa-core`, `kappa-types`, `kappa-module-git`, `kappa-module-distribution`, `kappa-module-identity`, `kappa-module-passkey`, `kappa-reconcile`, `kappa-akd`.
3. Prism: run `npx prism-code@latest setup`, then `npx prism-code --help`. Read the docs index at universal-coordinate-foundation.lovable.app/docs/llms.txt, especially write-the-model, manifest, world-and-capabilities, holo-format, ship, release-status.
4. Prior art for this exact pattern: github.com/UOR-Foundation/foundry (formerly humuhumu33/hologram-forge). A Lean model is the authority, it is projected to Rust and wasm32, a service worker is the kernel, storage is a device store keyed by BLAKE3 address, the product is a `.holo`.
5. LexLean: the `lexlean` MCP server (lexicon search, check, verify) and any local checkout of LexLean and PrismPM.

## Facts already established

Gitea is a Go server with server-rendered templates, a SQL database and a git binary. It cannot run in a browser as it stands.
kappa-registry is one binary speaking OCI, Git smart HTTP with LFS, S3, Nix and optionally AT Protocol over one content-addressed store.
In kappa the store never computes digests; the caller supplies the kappa. sha256, sha512, blake3 and sha1 are structurally equal.
dCBOR is the canonical encoding for addressing, signing and persistence. JSON is wire format only.
An identity anchor is `sha256(dCBOR(algorithm || public_key_bytes))` over Ed25519, P-256 or K-256. Passkey routes exist.
kappa-distribution adds typed edges (`owns`, `delegation`, `capability`, `revocation`, `assertion`, `derived-from`, `refers-to`, `section-of`, `epoch-root`, `chunk-manifest` and others), tag compare-and-swap, transactions, bundles, signed epoch roots, and set reconciliation (RBSR).
The Prism one-sentence path (`prism/spec.json`, `prism/spec/1`) only covers an app that decides one answer from a line of fields. This app is not that. It is a hand-written LexLean project started with `prism-code init`.

## Unknowns you must resolve, not assume

The exact kappa label format. Read `KappaLabel` in the source. Do not invent one.
The UOR address derivation Prism uses. The design doc was not reachable; find the normative source.
Whether `kappa-core` and `kappa-types` compile to wasm32. If not, propose the smallest upstream change.
Which Prism features are shipped. The docs release page and the installed CLI disagree; trust the installed `--help` and say which you relied on.
What a hand-written model can express: state, multiple intents, byte strings, maps. This decides how much logic lives in the proved core.

Stop and report if any of these blocks the architecture below.

## Hard requirements

No application server, no database process, no relay, no proxy. Only a browser and static file hosting.
Every stored object is addressed by its kappa and re-verified on read. Bytes that do not re-derive to their address are refused.
Authority comes from signatures, never from where bytes were fetched. Every replica is untrusted.
Works in current Chrome, Firefox and Safari, offline after first load.
Specifications are LexLean, kernel-checked by Lean. Say "proved" only for what Lean proved and "tested" for the rest.
Lean and fast, with the budgets below enforced in CI.

## Architecture decisions

Gitea is the reference, not the runtime. Do not compile Go to WebAssembly. Port semantics, keep MIT attribution in `UPSTREAM.md`.
The core is one LexLean model projected to Rust and wasm32, shipped in the `.holo`. It owns every rule: addressing, permissions, ref updates, state machines, visible text.
A service worker is the kernel of the origin. It answers the URL map locally, so pages and API share one implementation.
Local storage is OPFS, laid out as kappa's `blobs/{algo}/{shard}` plus a tag and edge index.
Git objects keep their native object IDs (sha1 and sha256 formats) as kappas on their own axis. Packfile parsing, delta resolution, diff and merge run in WASM workers.
Replication uses kappa-registry peers or any static host as dumb replicas. Sync is RBSR reconciliation plus tag compare-and-swap.
Native `git clone` and `git push` from a terminal work against any kappa-registry peer's Git surface. A browser cannot accept inbound connections; state this plainly in the docs.
Mutable collaboration state (issues, pull requests, reviews, comments, labels, milestones, settings) is a signed, content-addressed operation log per repository, merged deterministically. Relations are kappa typed edges.
Permissions are enforced by every reader: a pure function `authorized(aclState, op)` decides whether an operation counts. Unauthorized operations are ignored, not stored as truth.
Identity is passkeys and kappa anchors. No passwords. Delegation and revocation are edges.
Private repositories are encrypted on the client; keys are shared through capability edges.

## Feature completeness

First deliverable: `docs/PARITY.md`, one row per Gitea feature, marked full, adapted or non-goal, with the reason. Get approval before building.
Expect full: repositories, branches, tags, code browsing, blame, history, diff, pull requests with review and merge strategies, issues, labels, milestones, projects, wiki, releases, organisations, teams, branch protection, LFS, client-side search, REST API shaped like Gitea's.
Expect adapted, and say how: Actions (jobs run as WASM in a contributor's browser, results are signed attestations; arbitrary containers are out), packages (OCI, Nix and S3 come from kappa; others by tier), notifications (derived from the log; no email), webhooks, mirrors and import (subject to browser cross-origin limits).
Expect non-goal: admin panel, OAuth provider, SMTP, SSH transport.
One open problem to solve explicitly: familiar `#123` numbers without a server to allocate them.

## Problems this must solve

One principle carries most of this section: work is a function of content, so identical content never causes work twice.
Define an action key as the kappa of `dCBOR(step definition kappa, input tree kappas, toolchain kappa, declared environment)`.
A result is a signed attestation stored under its action key. Before doing any work, look the key up; if a trusted result exists, reuse it.
Keys are derived by the core, never written by hand. Apply this to builds, tests, lint, diffs, search indexes, rendered markdown, blame and merge results.

Design each row below as a requirement, and add any you find in Phase 0.

Runners and continuous integration.
- No runner available, queueing, concurrency or usage limits: there is no central runner pool. Any browser tab or peer holding the capability can execute a job, and the result is valid wherever it ran.
- Opaque failure, such as "not handing out runners, cause unknown": every job has an explicit state and reason derivable locally. No hidden queue, no status page to check.
- Re-running unchanged work: key jobs on the tree kappa, not the commit. A rebase, merge or re-push that yields an already-tested tree runs nothing.
- Whole-pipeline runs for a one-file change: each step declares its input paths, so its key covers only those subtrees. Untouched steps are cache hits.
- Hand-written, wrong or poisoned cache keys: keys are derived and results are verified against their address and signature.
- Reinstalling dependencies every run: dependencies are blobs fetched once by kappa and shared across repositories and forks.
- Flaky tests: jobs run in WASM under a capability set that denies clock, network and randomness unless declared. Two executors disagreeing on one key is reported as nondeterminism.
- "Works on my machine": the toolchain is part of the key and pinned by kappa.
- Merge queues: test the exact merged tree kappa once; the merge then publishes that tree.

Supply chain and trust.
- Mutable action tags and hijacked dependencies: every reference resolves to a kappa. A tag is a signed compare-and-swap binding with visible history.
- Unverifiable releases: a release is an attestation chain from source tree to artifact by action key. Anyone can replay it.
- Secrets leaking in logs or to forks: secrets are granted by capability edge to named executors only, and a job's world cannot import what it was not granted.

Review and history.
- Approvals going stale or being wrongly kept after a force-push: an approval binds to the diff kappa. An identical diff after rebase keeps it; any change drops it.
- Re-reading a whole pull request after an update: show the interdiff between the reviewed kappa and the new one.
- History lost to force-push: objects are immutable and ref history is a signed log.
- Merge conflicts resolved repeatedly: a resolution is stored under the kappa of the conflicting pair and reused.

Scale, cost and availability.
- Slow clones and huge monorepos: fetch trees and blobs lazily by kappa; never download what is already held.
- Forks duplicating storage: a fork is a new set of refs over the same objects, at zero copy cost.
- Large file cost: content-defined chunking with `chunk-manifest` edges, so edits to large files store only changed chunks.
- Outages, rate limits and lock-in: reads and writes are local first; any replica can serve; export is a bundle of addressed objects.

Slow checks.
- Feedback starts only after a push: checks run locally before the push, in the same engine, and produce the same attestations. A push arrives already verified.
- Setup dominates run time (checkout, toolchain install, dependency restore): none of it exists. Objects are already held and the toolchain is addressed.
- Every test runs on every change: key each test on its dependency closure, so only tests whose inputs changed run.
- Serial pipelines: steps form a graph from declared inputs and outputs, and independent steps run in parallel across tabs and peers.
- Superseded work keeps running: a newer tree on the same ref cancels jobs for the old tree unless another ref still needs them.

Slow and buggy merging.
- Required checks stuck on "expected, waiting for status": a check is satisfied if and only if a trusted attestation exists for its key on this tree. A step with unchanged inputs is satisfied by its earlier result, never left pending.
- Status attached to the wrong commit, or lost and delayed webhooks: status is derived from the tree kappa by whoever looks. There is nothing to deliver.
- "Branch is out of date" forcing an update and a full re-run: compute the merged tree and run only steps whose inputs differ from results already held.
- Slow "checking mergeability": the merge of (base, ours, theirs) is memoised by those three kappas.
- Changes that pass alone and break together: checks run on the merged tree, not the branch tip.
- A queue failure ejects a whole batch: bisect using cached results, so only the untested combinations run.
- "Re-run until green": a key has one result history. A retry is appended, never overwrites, and a pass after a fail marks the step flaky and is counted.
- Failures already present on the base block unrelated work: a failure has a kappa. If the same failure exists on the base tree, attribute it to the base, not the change.
- Merge is a pure function `mergeable(policy, attestations, tree)` any replica can evaluate. Auto-merge is that function becoming true.

Working with AI coding tools.
- Agents poll for check results and burn time and tokens: checks run locally and return synchronously; remote results arrive as events, never by polling.
- Many small pushes, each triggering a full pipeline: step-level reuse makes each push cost only what changed.
- Parallel agents duplicate or collide: identical changes share one diff kappa and are detected as the same work. Overlapping changes to the same subtree are flagged when opened, not at merge.
- Long chains of dependent changes: stacked pull requests are first class, retarget automatically, and reuse results down the stack.
- Agents cannot use huge logs: a failure is a small structured record with the failing test, its input kappas and one command that reproduces it.
- Agents make checks pass by editing tests, workflows or policy: check definitions and merge policy are read from the base, not the change. Edits to them are flagged and need human approval.
- Unclear authorship and unbounded access: an agent signs with its own anchor under a `delegation` edge from a human, scoped, time-limited and revocable.
- Large generated diffs swamp review: files with a `derived-from` edge are verified by reproducing them, and collapsed in review.
- Instructions hidden in issues and comments: the agent interface labels every piece of content with its author's anchor and trust level.
- Rate limits and token expiry stall agents: the interface is local. Expose it as a typed API and an MCP server with the same rules as the page.

State the limits honestly.
Reuse is only sound for deterministic steps. A step that needs network, time or randomness must be declared impure and is recorded, not cached.
A browser runs WASM, not containers. Toolchains without a WASM build need a peer executor: a contributor's machine, still not a server we operate.
A result from an untrusted executor is not truth. Define a policy: trusted anchors, or matching attestations from k independent executors.

## What LexLean must prove
Action keys: equal keys imply equal declared inputs, and lookup never returns a result stored under a different key.
Reuse policy: a result is accepted only if its attestations satisfy the repository's trust policy.
Approvals: an approval counts only for the diff kappa it was signed over.
Merge: `mergeable` is a pure function of policy, attestations and tree, and its policy and check definitions come from the base.
Result history: a result is never overwritten, and a required check cannot be satisfied without an attestation for its exact key.
Delegation: an agent's operation counts only within the scope and lifetime of an unrevoked delegation.

Address soundness: restore refuses bytes that do not re-derive to their kappa.
Log merge is commutative, associative and idempotent, so replicas converge.
Authorization: deny by default, revocation overrides grant, no unauthorized operation changes derived state.
Ref updates: compare-and-swap, fast-forward only unless force is permitted, protected branch rules hold.
Pull request state machine: merged and closed transitions are valid, merge requires the configured approvals and checks.
Capability set: the world imports nothing beyond the grant.
One theorem per intent sentence. Run tiers in order: `build --check`, `verify --lean`, `axioms --write`, `verify`.

## Experience

Match GitHub's URL scheme, page layout, navigation, keyboard shortcuts and markdown behaviour so muscle memory transfers.
Use openly licensed components only. Do not use GitHub's name, logo or proprietary assets.
Every action applies locally at once and syncs in the background. Show sync and verification state without getting in the way.

## Budgets, enforced in CI

Cold first paint under 1 s on a mid-range laptop; warm navigation under 50 ms.
App shell under 150 KB compressed; core wasm under 1 MB compressed.
Blobless partial clone by default; fetch blobs on demand by kappa.
Virtualised file trees and diffs; a 10,000-file repository stays responsive.
A job whose action key already has a trusted result completes in under 100 ms and executes nothing.
Re-pushing an unchanged tree transfers no objects and triggers no work.
Report the cache hit rate and bytes not transferred on every run, so the saving is measured, not claimed.
Treat these as starting targets; measure, then tighten or justify.

## Process

Phase 0: study, `STUDY.md`, `PARITY.md`, `ARCHITECTURE.md`, threat model. Stop for approval.
Phase 1: model and proofs for addressing, identity, permissions and the log.
Phase 2: git read path: clone, browse, history, diff, blame.
Phase 3: write path: commit, push, sync, protected refs.
Phase 4: issues, pull requests, review, merge.
Phase 5: organisations, wiki, releases, projects, search, API.
Phase 6: adapted features, private repositories, hardening, audit.
Each phase ends with proofs passing, acceptance vectors replaying, budgets met, and a live page.
Ask before creating the repository; propose a name and wait for approval. Commit and push only when asked.
Push back on any requirement that conflicts with another, with evidence, before working around it.

## Done

A stranger opens the page, signs in with a passkey, imports a repository, opens a pull request, reviews and merges it, with no server we operate.
A second contributor pushes a rebase of the same change and no job runs, because every result is reused.
An AI agent under a scoped delegation opens a stacked change, gets check results without polling, and cannot merge by editing the checks.
`prism-code check` passes, every acceptance vector replays, and `PARITY.md` has no unexplained row.
