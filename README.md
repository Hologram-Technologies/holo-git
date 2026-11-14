# holo-git

A serverless code-hosting application that runs entirely in the browser, built as a Prism application.
Gitea is the reference for features. LexLean specifies the rules and Lean proves them. Storage is content-addressed with kappa labels.

Status: Phase 1 complete, with the gaps listed below. The holo builds on GitHub Actions and replays 16 of 16 acceptance vectors. It rates P0: it does not yet carry provenance, proof or replay statements inside it.

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

## Read next

- `docs/STUDY.md`: what the sources actually say.
- `docs/ARCHITECTURE.md`: the design.
- `docs/PARITY.md`: every Gitea feature and its status here.
- `docs/THREAT-MODEL.md`: what is defended and what is not.
- `docs/PROMPT.md`: the original brief. Where it disagrees with the study, the study is right.
