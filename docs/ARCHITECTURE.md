# Architecture

Proposed for approval. Grounded in `STUDY.md`.

## Shape

Three layers, in one static page.

| Layer | What it is | How it is trusted |
|---|---|---|
| Kernel | LexLean model, projected to a WASM guest of about 100 KB. Pure function, bytes in, bytes out. | Proved in Lean, plus acceptance vectors |
| Engine | Rust compiled to WASM: git objects, packfiles, diff, three-way merge, hashing, canonical encoding. | Tested against git itself, byte for byte |
| Host | Service worker, storage, sync, signing, interface. | Tested; kept small; asks the kernel before every decision |

The kernel decides. The engine computes. The host moves bytes and draws.
No layer acts on a decision the kernel did not return.

## Kernel

One entry, many operations, each a small request carrying only the evidence it needs.
Requests stay under 1 MiB, so the kernel never receives whole repositories or whole membership lists; it receives the chain that proves one fact.

Operations:
- `authorize(op, evidence)`: does this signed operation count, given the delegation and capability chain presented.
- `refUpdate(old, new, rule, evidence)`: may this ref move.
- `mergeable(policy, attestations, tree)`: may this change merge.
- `orderOps(a, b)`: the total order that makes concurrent edits converge.
- `actionKeyPreimage(step, inputs, toolchain, env)`: the canonical bytes whose hash is the action key.
- `acceptResult(policy, attestations)`: is a reused result trusted.
- `restoreDecision(label, observed)`: refuse bytes that do not match their address.
- `view(state)`: every piece of visible rule text, so the interface cannot misstate a rule.

The model owns every preimage. The host only hashes.

## Addressing

One label form everywhere: `<axis>:<hex>`, the kappa label.
Git objects keep their own identity: `sha1:<oid>` or `sha256:<oid>` over the loose-object bytes. This is exactly how a kappa peer stores them, so no translation exists.
Everything we invent (operations, attestations, results, indexes, policies) is `blake3:` over canonical dCBOR.
New repositories default to git's SHA-256 object format; SHA-1 repositories import unchanged.
A kappa peer adds its mandatory `sha256` address by itself.

## Storage

Object bytes in OPFS, sharded by label. Refs, operation log heads and indexes in IndexedDB. The shell in the Cache API, keyed by its closure digest.
Foundry uses IndexedDB for everything. A repository has hundreds of thousands of objects, so bytes go to files. This choice is to be measured in Phase 2 and reversed if wrong.
Every read re-derives the label. A mismatch is refused, never repaired silently.

## State without a server

Git content is already immutable and addressed.
Everything else is a signed operation: open issue, comment, review, label, change setting, grant access.
An operation is dCBOR `{repository, author anchor, parents, payload, signature}` addressed by `blake3`.
State is the fold of authorized operations in kernel order. Unauthorized operations are stored but never counted.

Numbers. `#123` needs one agreed order. A repository names a home replica; its log head moves by compare-and-swap, and position in that chain is the number.
Work done offline carries a short provisional identifier and takes its number on first sync.
The replica cannot forge or alter operations. It can withhold or show different heads to different people; signed heads exchanged between clients expose that.

## Identity

A passkey proves the person. Asking for a passkey touch on every action is unusable, so the passkey signs a delegation to a session key held in the browser, non-extractable, scoped and time-limited.
Anchors follow kappa: `sha256(dCBOR({0: algorithm, 1: public key}))`.
Agents and executors are anchors under a delegation from a person. Chains are at most five long, matching kappa.
Grants and revocations are signed operations in the repository log, not server edges, because kappa edges are unsigned.

## Replicas

A replica is anything offering three calls: get by label, put by label, compare-and-swap a named head.

| Replica | Read from browser | Write from browser | Notes |
|---|---|---|---|
| kappa peer, another origin | yes | no | stock router blocks cross-origin writes |
| kappa peer, same origin as the app | yes | yes | the peer also serves the static page |
| kappa peer with an upstream change | yes | yes | needs allow-listed cross-origin writes and two more allowed headers |
| Object storage bucket with cross-origin rules and conditional writes | yes | yes | no process of ours; the provider's access rules apply |
| Static host | yes | no | publish-only mirrors |
| Terminal `git push` to any kappa peer | n/a | yes | works today |

Recommendation: write the replica interface first, ship the bucket and same-origin peer adapters, and propose the cross-origin change upstream. Reads from any kappa peer work on day one.
This is the honest reading of "serverless": no process of ours decides anything. Bytes still have to rest somewhere reachable.

## Work reuse

Action key: `blake3` of the kernel's preimage over step definition, input tree labels, toolchain label and declared environment.
Results are attestations stored under the key. Look up before running; accept under the repository's trust policy.
The same mechanism serves checks, merges (keyed by base, ours, theirs), diffs, blame, search indexes and rendered markdown.
Checks run in the browser as WASM. Prism capabilities are declarations only, so the sandbox that denies clock, network and randomness is ours to build and test.
Steps that need a native toolchain run on a contributor's machine through a small executor that speaks the same key and attestation format.

## Private repositories

Encrypt on the client before any byte leaves. kappa's encryption is server-side and off.
Encrypted bytes are addressed by ciphertext; the plaintext label lives inside the encrypted index.
Deduplication across repositories is lost for private content. Revoking a reader cannot un-share what they already fetched; it rotates the key for what follows.

## Interface

A new single-page interface, one implementation behind the service worker, following Gitea's URL map and GitHub's layout conventions.
Markdown and any repository-supplied HTML render in an opaque-origin sandbox, as Foundry does for previews.

## Build

Start from `UOR-Foundation/template`'s `app/` layout, LexLean language 1.2.
Tiers on every change: `build --check`, `verify --lean`, `axioms --write`, `verify`.
Full builds use the SDK image under WSL, or `build --remote github` until this application can check itself.
Budget about 20 minutes per full proof run, on Foundry's evidence.

## Corrections to the prompt

The proved core is a decision kernel, not the whole core.
kappa typed edges, epoch roots and passkey routes are not a trust layer we can lean on. Ours is client-side.
Reconciliation is range fingerprints over ref names plus object walks, not set reconciliation.
Content-defined chunking is ours to build, not provided.
Storage follows the split above, not kappa's on-disk layout.

## Risks

1. The toolchain moves weekly. Pin everything; expect breakage.
2. The largest proved model on record is Foundry's. Ours will be larger. Proof time may dominate iteration.
3. The host is unproved and large. A bug there bypasses nothing the kernel decided, but can fail to ask.
4. Browser writes to kappa peers depend on an upstream change we do not control.
5. Per-test dependency tracking and failure normalisation are research-grade problems, not plumbing.
6. Scope. Gitea is roughly 830 routes. The parity matrix must be cut into releases.
