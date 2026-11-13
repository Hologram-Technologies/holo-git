# holo-git

A serverless code-hosting application that runs entirely in the browser, built as a Prism application.
Gitea is the reference for features. LexLean specifies the rules and Lean proves them. Storage is content-addressed with kappa labels.

Status: Phase 1 in progress. The holo builds on GitHub Actions and replays 13 of 13 acceptance vectors. It rates P0: it does not yet carry provenance, proof or replay statements inside it.

## What is proved today

Lean checks 19 theorems in `src/`.

- Authorization (`Access`, `AccessProofs`): an unsigned, revoked or expired operation never counts; no grant cannot read; owner permits everything; access is reflexive and transitive.
- Delegation (`Delegation`, `DelegationProofs`): a revoked, unsigned or dead link grants nothing; a link never widens access and never exceeds its scope. Expiry is three separate lemmas, not one end-to-end statement.
- Addressing (`Address`): the restore decision is true exactly when the claimed and observed labels match.
- Operation order (`OpLog`, `OpLogProofs`): the order is irreflexive, asymmetric and transitive.

The entry point (`Kernel`) answers three operations: authorize, order, and narrow through one delegation link.
Addressing is proved but not yet reachable from the entry point. Chains of several links are not modelled.

## Read next

- `docs/STUDY.md`: what the sources actually say.
- `docs/ARCHITECTURE.md`: the design.
- `docs/PARITY.md`: every Gitea feature and its status here.
- `docs/THREAT-MODEL.md`: what is defended and what is not.
- `docs/PROMPT.md`: the original brief. Where it disagrees with the study, the study is right.

## Check it

```bash
npx prism-code@latest build --check
npx prism-code@latest verify --lean
```
