# holo-git

A serverless code-hosting application that runs entirely in the browser, built as a Prism application.
Gitea is the reference for features. LexLean specifies the rules and Lean proves them. Storage is content-addressed with kappa labels.

Status: Phase 1 complete, with the gaps listed below. Phase 2 has its first slice: clone and browse in the browser. The holo builds on GitHub Actions and replays 16 of 16 acceptance vectors. It rates P0: it does not yet carry provenance, proof or replay statements inside it.

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

`engine/` is the git engine in Rust: object hashing, packfile reading, delta resolution, commit and tree parsing, line diff and blame. It compiles to 77 KB of WebAssembly with no imports. `web/` is the page.

What works, tested in a browser:

- Clone from any static replica that serves a bare repository as files. No server-side git.
- Every object's identifier is computed from its bytes; nothing is taken from the replica's index.
- Objects are stored on the device under kappa labels (`sha1:<id>`) as loose-object bytes, the form a kappa peer stores.
- Every read re-derives the label. Altered bytes are refused.
- Browse files, view a file, list history.
- Line diffs on each commit, with context, computed by a minimal Myers diff in the engine.
- Blame for any file, following the first-parent line. Commits that left the file's label unchanged are skipped without reading it.

What is tested: eight engine tests run against git itself.

- Every object in a real packfile matches `git cat-file`, byte for byte, and damaged packs are refused.
- 66 diff cases rebuild the new file exactly and are as short as `git diff --minimal`.
- Blame names the same commit as `git blame` on every line of a 25-commit history.

The page was exercised by hand against a replica of this repository: the object count matches git, the added and removed line counts match `git show --numstat` for 27 files in three commits, and the README's blame matches `git blame`.

Not done yet: rename detection (a rename shows as a removal and an addition), blame through merges, markdown rendering, a service worker, partial clone, and large repositories (a pack is held in memory whole). Diffs with more than 2,000 differing lines fall back to a full replacement. The page does not yet call the proved kernel; label checks run in the engine. Storage is IndexedDB, not the file store the architecture proposes. The page has no automated tests.

```bash
(cd engine && cargo test --release)
sh scripts/build-web.sh
python -m http.server 8731 --directory web
```

## Read next

- `docs/STUDY.md`: what the sources actually say.
- `docs/ARCHITECTURE.md`: the design.
- `docs/PARITY.md`: every Gitea feature and its status here.
- `docs/THREAT-MODEL.md`: what is defended and what is not.
- `docs/PROMPT.md`: the original brief. Where it disagrees with the study, the study is right.
