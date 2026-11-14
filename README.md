# holo-git

A serverless code-hosting application that runs entirely in the browser, built as a Prism application.

Live page: https://humuhumu33.github.io/holo-git/ . Press Clone and it clones this repository from a static replica published beside it.
Gitea is the reference for features. LexLean specifies the rules and Lean proves them. Storage is content-addressed with kappa labels.

Status: Phase 1 complete, with the gaps listed below. Phase 2 works in the browser: clone, browse, diff, blame, offline. Phase 3 has its first slice: commit in the browser and export to git. The holo builds on GitHub Actions and replays 16 of 16 acceptance vectors. It rates P0: it does not yet carry provenance, proof or replay statements inside it.

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

Not done yet: rename detection (a rename shows as a removal and an addition), blame through merges, markdown rendering, partial clone, and large repositories (a pack is held in memory whole). Diffs with more than 2,000 differing lines fall back to a full replacement. Storage is IndexedDB, not the file store the architecture proposes. The page has no automated tests. The pin does not protect the first visit, and a visitor who accepts a new version without comparing digests is trusting the host again.

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

- There is no push. No writable replica exists that a browser can reach; the bundle is the bridge until one does.
- The device key is the only identity. It is not bound to a passkey or a person, and it is not the kappa anchor form. Clearing site data destroys it.
- On a device, the key that made the clone is treated as its owner. Grants from other people, delegation chains and protected branches are not wired in, though the kernel proves the rules for the first two.
- The fast-forward check is in the host, not in the kernel.
- One file per commit, text only, on an existing branch. No new branches, deletes, renames or merges.
- The kernel guest is a committed build output. `scripts/build-web.sh` checks its SHA-256 against `scripts/kernel.sha256`, but the Pages build does not rebuild it from the model.

Kernel guest: SHA-256 `ee9893cf32b8fb138df7473d316311622c30b8c7ad5e5ad497e5ab5330fd0a04`, from commit `f55bf58`, run https://github.com/humuhumu33/holo-git/actions/runs/43533133768, holo fingerprint `blake3:8a6128ba580da7916c4ea2ddea871662cc39dff1eabe803b497d1d0284dc56c6`.

## Read next

- `docs/STUDY.md`: what the sources actually say.
- `docs/ARCHITECTURE.md`: the design.
- `docs/PARITY.md`: every Gitea feature and its status here.
- `docs/THREAT-MODEL.md`: what is defended and what is not.
- `docs/PROMPT.md`: the original brief. Where it disagrees with the study, the study is right.
