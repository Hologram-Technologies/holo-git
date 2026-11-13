# holo-git

A serverless code-hosting application that runs entirely in the browser, built as a Prism application.
Gitea is the reference for features. LexLean specifies the rules and Lean proves them. Storage is content-addressed with kappa labels.

Status: Phase 1, first slice. No holo has been built yet.

## What is proved today

Lean checks 12 theorems in `src/`.

- Authorization (`Access`, `AccessProofs`): an unsigned, revoked or expired operation never counts; no grant cannot read; owner permits everything; access is reflexive and transitive.
- Addressing (`Address`): the restore decision is true exactly when the claimed and observed labels match.
- Operation order (`OpLog`): the order is irreflexive, asymmetric and transitive.

The entry point (`TextRequest`) answers `allow`, `deny` or `invalid` for a 6-byte authorization request.
Addressing and operation order are proved but not yet reachable from the entry point.

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
