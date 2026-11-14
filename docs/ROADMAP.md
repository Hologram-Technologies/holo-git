# Roadmap

Written 2026-11-14. The goal that orders everything here: stop waiting on checks and merges.

## Where the time went while building this

These are waits measured in this project, not estimates. They are the problem in miniature.

| Wait | How long | Why it is waste |
|---|---|---|
| Kernel build on GitHub Actions | 7 to 10 minutes, every time | Rebuilt from nothing even when the model did not change |
| Kernel build on the development machine | Never finished | Timed out twice, then took the container host down |
| Lean verification | 70 to 100 seconds | All 14 modules are verified again when one changed |
| Settling axiom lists | One full verification per wrong list | The verifier reports one mismatch per run; one change took six runs |
| Page deploy checks | About a minute | Engine and page tests all run again for a README change |
| Finding the right build | One failed attempt | The build tool picked up another workflow's run for the same commit |
| Three kernel builds for three small rule changes | About 30 minutes in all | Each rebuilt every module; each change touched one or two |

None of these waits is the first time a piece of work is done. Every one is work being done again, or a queue.

## What "faster" can honestly mean

Doing a piece of work for the first time will not get faster here: Lean proves at Lean's speed, a compiler compiles at its speed.
What can go to zero is everything else:

- Work whose inputs did not change is never run again, by anyone.
- A check runs before the push, on the machine that made the change, and its result travels with the change.
- There is no queue, because there is no runner pool to wait for.
- A merge of already-tested content needs no new checks.

For a change that touches one file out of many, most checks are in the first category. That is where a large multiple comes from. A change that touches everything gains little. Whether the overall figure is 10 or 100 depends on how much of a team's checking is repeated work, which must be measured, not assumed.

## Order of work

1. **Protected branches.** Done.
2. **Thin pull requests.** Done. A pull request is a signed record naming a base and a head. An approval is a signed record bound to the exact tree it approved. The merge gate is one kernel decision: the required approvals and the required checks exist for this tree. Only what checks need to attach to; no discussion threads yet.
3. **Checks keyed by content.** A check result is a signed record stored under a key derived from the step, the labels of the subtrees it reads, and the toolchain. Before running anything, look the key up. The first workload is this repository:
   - engine tests, keyed on `engine/`;
   - page tests, keyed on `web/`, `test/` and the two WebAssembly files;
   - Lean verification, keyed per module on the module and what it imports;
   - the kernel build, keyed on `src/` and the build image.
   The executor is a small command run on a contributor's machine, because a browser cannot run a compiler or Lean. It publishes results to the replica; the page reads them.
4. **Measure.** For this repository's own history, replay the last fifty changes and count the checks that would have run against the checks that did. Publish the number.
5. **Self-hosting.** Develop this repository through itself, with GitHub as a mirror.
6. **The rest of collaboration:** issues, review discussion, organisations.
7. **Identity and privacy:** passkeys, encrypted private repositories, rollback detection.
8. **Scale and feel:** packs for transfer, large repositories, measured budgets, three browsers.
9. **Assurance:** proofs carried in the holo, reproducible builds, kappa-registry accepting browser writes.

Steps 2 to 4 are the product. If step 4's number is small, the plan is wrong and should change.

## Open issues with LexLean and Prism, as met in this project

Recorded as observed, with the workaround used. Each cost real time.

**Speed**
- Verification is not incremental. A change to one module verifies all of them.
- The full build starts from nothing each time and takes 7 to 10 minutes on a hosted runner. Locally it timed out with `PP5007` and could not be made to finish.
- Theorems in a module the application imports made the local build time out. Workaround: keep theorems in separate modules the application never imports.

**Proving**
- The proof steps are a closed set. A statement that needs both case analysis and arithmetic could not be proved; it had to be split into one lemma of each kind, leaving the join unproved. "An expired link is invalid" is still two lemmas for this reason.
- A proved lemma cannot be used to rewrite inside a later proof. Composition is by exact application only.
- Case analysis is refused on Booleans in the pinned toolchain. Workaround: a two-value type.
- Case analysis multiplies. Five modes across five links is 3,125 cases per theorem, so that property is proved for two values only.
- The byte decoding at the kernel's edge cannot use lists and is tested, not proved.

**Friction**
- Every definition's axiom list must match exactly what Lean observes. The local tool that fills them in runs only in the build image; the hosted verifier reports one mismatch per run.
- The lock and format tools exist only in a 20 GB image. With the container host down they could not run, and the lockfile in the repository went stale.
- Module titles must be made of words from the lexicon, a parameter named `id` or `first` is refused, and errors point at byte offsets in a whole module.
- The documentation describes a version several releases behind the installed tool.
- The hosted verifier stores what it is sent unlisted, not privately.
- The remote build reuses any workflow run for a commit, including one that produced no holo.

**Assurance**
- The holo rates P0. The proofs are verified but not carried inside it, so someone pulling the holo cannot check them from the holo alone.
- No SDK release exists; the build image is a candidate.

Two of these are also this roadmap's opportunity: incremental verification and reuse of an unchanged build are exactly what step 3 provides from the outside, for any toolchain.
