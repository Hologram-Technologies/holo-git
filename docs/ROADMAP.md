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
| This repository's CI, before reuse | About 1 to 4 minutes on every push | Every check ran whatever the push changed |
| This repository's CI, with reuse | 3 min 25 s when every check must run; about 30 s when none must | Most of the long case is Lean verifying all sixteen modules for a change to one |
| Three kernel builds for three small rule changes | About 30 minutes in all | Each rebuilt every module; each change touched one or two |

None of these waits is the first time a piece of work is done. Every one is work being done again, or a queue.

## What went wrong on the way

Recorded because each of these is the kind of failure this project exists to prevent.

- For four pushes, this repository's CI did not fail when a check failed. The workflow read its exit status after a later command had replaced it. No check failed in that window, so nothing wrong was deployed, but nothing would have stopped it. Found by reading a summary that said "1 failing" above a green tick.
- The first isolated run of the checks failed because of a path-length limit on the development machine, and the failures were stored as results. A machine's failure and the content's failure look the same to a cache.
- A check with a stored pass was reported as failing where its environment variables were absent, because the variables were looked for before the result.
- A kernel binary was committed corrupted, because the repository's line-ending rule treated it as text. The build's digest check would have refused it.

## What "faster" can honestly mean

Doing a piece of work for the first time will not get faster here: Lean proves at Lean's speed, a compiler compiles at its speed.
What can go to zero is everything else:

- Work whose inputs did not change is never run again, by anyone.
- A check runs before the push, on the machine that made the change, and its result travels with the change.
- There is no queue, because there is no runner pool to wait for.
- A merge of already-tested content needs no new checks.

For a change that touches one file out of many, most checks are in the first category. That is where a large multiple comes from. A change that touches everything gains little. Whether the overall figure is 10 or 100 depends on how much of a team's checking is repeated work, which must be measured, not assumed.

## Measured on a larger codebase

Step 4 below said to measure again before drawing conclusions. Done on 2026-11-14 against LexLean, read only: its main history, 43 completed pull request runs, and the job results of each. The plan changed as a result.

**Reuse keyed by directory is worth little there.** Over the last 150 commits on main, six checks cut along directories would have avoided 20 percent of runs, against 62 percent here. Nearly every commit touches the compiler, and every check reads the compiler.

**Reuse keyed by what a step really consumes is worth a great deal, for the steps that have such a key.** LexLean commits each example's generated Lean, and its gate confirms the compiler reproduces it. Keyed by those bytes and the toolchain files, the examples need 70 Lean runs where today's cut needs 1,316, and the fourteen Atlas shards need 71 where one per commit is 2,100. But those legs are 15 percent of the full gate's machine time. Scenario tests are 49 percent and the other hosts 27 percent; both depend on the compiler itself.

**Inside pull requests there was almost nothing to reuse.** One job minute of 13,695 repeated a leg that had already passed on unchanged inputs. Runs do not get far enough to leave passed work behind:

| What happened | Runs | Wall time, median | Work done, median |
|---|---|---|---|
| Failed at the first stage | 12 | 66 min | 3 job minutes |
| Cancelled at the first stage | 19 | 15 min | none |
| Reached the full gate and did not pass | 8 | about 4 hours | about 21 machine-hours |
| Reached the full gate and passed | 1 | 13 hours | 21 machine-hours |

The usual first-stage failure is a check that fails in about two minutes. The first leg of a run starts a median 21 minutes after the run is created, and up to 70. The cause of that wait was not confirmed; a queue for runners is the likely one.

So the time goes, in order, to: waiting an hour to be told what two minutes on the author's machine would have said; a full gate that costs 21 machine-hours an attempt and passes one time in nine; and only then to repeated work.

Limits of this measurement: the input sets were drawn from directory names and the recipe list, not from tracing what each recipe opens; pushes were compared head to head, ignoring movement of the base branch; five comparisons exceeded the 300-file limit and were counted as changing everything; and LexLean's own specification requires its gate to run from a clean checkout, so any reuse there is its maintainers' decision.

## Order of work

What is left, reordered by the measurement above. The numbered list after it records what is done.

1. **A result that arrives with the push.** Built 2026-11-14, tested against the stand-in store only: results are signed, shared through any GET and PUT store, and accepted only from signers named on the protected branch. Not yet run against a durable store or on a real team's pull requests, and it does not refuse a push by itself; that is step 2. Original aim: A shared store of signed check results, so that a check run on the author's machine before pushing is the result the gate reads. No queue, and a two-minute failure costs two minutes. The local runner and the signed records exist; the store that others read them from does not. This is the largest measured loss and the smallest piece of work.
2. **Fail first, and say so.** Built 2026-11-14: known results are reported first, the rest run cheapest and likeliest to fail first, `--fail-fast` stops at the first failure, and a pre-push hook refuses a push whose content fails. Tested with real pushes to a local remote; not yet used on a real team's work. The hook can be skipped, so it saves time and guards nothing. Original aim: Run checks in order of cost and of how often they fail, stop at the first failure, and refuse the push locally. The measured case: the cheapest check was also the one that failed most.
3. **Keys from what a step consumes, not where files live.** Let a check name a produced file as its input (generated Lean, a compiled binary), so a change upstream that leaves the product unchanged runs nothing downstream. Proven on the examples and Atlas above; this is also "reuse inside a check" from step 5.
4. **A gate that keeps what passed.** When one leg of many fails, the others' results stand, and the next attempt runs only the failed leg and whatever its fix touched. Worth little until 1 to 3 let runs reach the gate; then it is what turns 21 machine-hours an attempt into the cost of the change.
5. **Tests keyed one by one.** The largest share of a big gate is tests that all read the program under test. Reuse there needs to know what each test reads. Unmeasured and the hardest; do not start before measuring one real suite.
6. The remaining soundness gaps, then collaboration, identity, scale and assurance, as numbered below.

What this does not fix: a check that is slow the first time, and a gate that fails because the change is wrong.

### Record of steps so far

1. **Protected branches.** Done.
2. **Thin pull requests.** Done. A pull request is a signed record naming a base and a head. An approval is a signed record bound to the exact tree it approved. The merge gate is one kernel decision: the required approvals and the required checks exist for this tree. Only what checks need to attach to; no discussion threads yet.
3. **Checks keyed by content.** Done, with the gaps listed in the README. A check result is a signed record stored under a key derived from the step, the labels of the subtrees it reads, and the toolchain. Before running anything, look the key up. The first workload is this repository:
   - engine tests, keyed on `engine/`;
   - page tests, keyed on `web/`, `test/` and the two WebAssembly files;
   - Lean verification, keyed per module on the module and what it imports;
   - the kernel build, keyed on `src/` and the build image.
   The executor is a small command run on a contributor's machine, because a browser cannot run a compiler or Lean. It publishes results to the replica; the page reads them.
4. **Measure.** Done once: over this repository's first 26 commits, 30 check runs with reuse against 78 without, 62 percent avoided. Far from 100 times; the history is short and most commits touched checked code. Measure again on a larger codebase before drawing conclusions.
5. **Close the soundness gaps in reuse**, because a wrongly reused pass is worse than a slow check. Done: declared tools and environment are in the key, and a check runs with only its declared inputs. Still open: real isolation from the network and clock, telling a machine's failure from the content's, named trusted runners, and reuse inside a check.
6. **Self-hosting.** Begun: this repository's history was published to a store, its main branch protected with its own checks, and changes taken through pull request, runner and merge from a git checkout. Not yet durable or public; see the README.
   Original aim: Develop this repository through itself, with GitHub as a mirror.
7. **The rest of collaboration:** issues, review discussion, organisations.
8. **Identity and privacy:** passkeys, encrypted private repositories, rollback detection.
9. **Scale and feel:** packs for transfer, large repositories, measured budgets, three browsers.
10. **Assurance:** proofs carried in the holo, reproducible builds, kappa-registry accepting browser writes.

Steps 2 to 4 are the product. If step 4's number is small, the plan is wrong and should change. On a larger codebase it was small, and the plan changed: see the order of work above.

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
