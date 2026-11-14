# Benchmark against a real project's CI

Run 2026-11-14 against LexLean (`UOR-Foundation/LexLean`), a public project with a heavy gate. Nothing in that repository was changed; its checks were defined in a file kept outside it.

## The question

When a pull request fails CI's first stage, how long does the author wait to be told, and how long would the same answer take from holo-git's check command run before the push?

## What was run

- **The commits.** The 12 most recent pull request runs that failed the first stage ("honesty"). CI tests a pull request merged into its base, so each run's exact merge commit was read from its log and fetched.
- **The command.** The stage's own steps at those commits, in its order: two Python test files, `cargo xtask check-freshness`, then `just fmt-check model spec-links bdd` with the same environment setting CI uses.
- **How.** `node scripts/check.mjs run --definitions FILE --commit MERGE --fail-fast`, in an isolated directory holding the committed tree, with the build directory kept between runs. Each commit was run once, then run again unchanged.
- **Where.** One developer machine, Linux, 12 cores, 13 GB of memory, the pinned Rust toolchain. Each commit's files were fetched before its timer started.
- **The baseline.** GitHub's own record of each run: from the run's creation to the first stage's failing verdict, and the first stage's own running time.

Left out: the toolchain install steps, and a hardware-instruction probe that one pull request adds to the stage.

## Results

| CI run | CI: start to verdict | CI: the check itself | Here: first run | Here: repeated | Faster to a verdict |
|---|---|---|---|---|---|
| 43514905812 | 84.0 min | 3.5 min | 154.8 s | 1.4 s | 33x |
| 43522955328 | 36.4 min | 2.2 min | 92.6 s | 0.2 s | 24x |
| 43523907586 | 90.5 min | 1.9 min | 49.8 s | 0.2 s | 109x |
| 43525392869 | 85.2 min | 2.4 min | 98.1 s | 0.2 s | 52x |
| 43525943926 | 87.6 min | 2.1 min | 141.6 s | 0.6 s | 37x |
| 43531038752 | 54.7 min | 2.3 min | 128.1 s | 0.4 s | 26x |
| 43543751849 | 64.7 min | 2.4 min | 5.8 s | 0.2 s | 669x |
| 43552140731 | 67.2 min | 2.3 min | 167.7 s | 1.1 s | 24x |
| 43558650466 | 74.9 min | 1.9 min | 112.5 s | 0.2 s | 40x |
| 43568948785 | 11.9 min | 3.2 min | 130.8 s | 0.6 s | 5x |
| 43575824658 | 45.9 min | 1.9 min | 223.9 s | 1.0 s | 12x |
| 43578688227 | 13.2 min | 1.7 min | 174.5 s | 0.9 s | 5x |

- **Same answer.** All 12 failed here as in CI, at the same step, for the same reason: 9 with generated files not regenerated, 2 on formatting, 1 on a stale generated document. One count differs by one (183 stale files here, 184 in CI); not explained.
- **Time to a verdict.** Median 65.9 minutes in CI, median 129 seconds here: 29 times faster at the median, between 5 and 669. In total, 716 minutes of waiting against 24.7.
- **Repeated on unchanged content.** Median 0.5 seconds, at most 1.4. CI has no equivalent; a re-run pays the whole wait again.

## What the numbers mean

- **The gain is the wait, not the work.** The check itself took a median 2.2 minutes in CI and 2.2 minutes here. CI spent the other 96 percent of the time before the check started. Running where the author is removes that.
- **This is not 100 times.** For this stage, on this project, a first run is about 29 times faster to a verdict. Only an unchanged repeat exceeds 100 times.
- **It covers the commonest failure, not the whole gate.** Of 43 recent pull request runs, 31 ended at this stage. The full gate behind it costs about 21 machine-hours an attempt and was not run here; nothing in this benchmark says it would be faster.
- **The first run of the day is slower.** The first commit included a build from nothing. A cold build of this stage alone took about five minutes in an earlier run.

## What it does not show

- One machine, one day, twelve commits. No repeats for variance.
- The local machine and CI's runners are different hardware.
- The runs went one after another with a warm build directory, in the order CI ran them. A developer switching between distant branches would see times nearer the slow end.
- Nobody used this while working. Whether authors would run it before pushing is not something a replay can show.

## A fault this found

The third commit first failed here with a compile error its CI did not have. The check's directory was being refilled with each file stamped with its commit's time, and cargo, which rebuilds by comparing times, kept a stale build. Fixed in `0011f1c`, with a test that fails on the old code. The table above is from after the fix. Two earlier attempts were discarded: one tested the pull requests' own commits, not the merges CI tested; one left out the freshness step where most failures happen.

## Second question: would keying by the product spare the example and Atlas runs?

LexLean commits each example's generated Lean. An earlier replay showed that product rarely changes, and I claimed that keying the Lean verification by it would avoid about 95 percent of example runs. This section tests the premise that claim rests on: **the same product gives the same verified result.**

### What was used

No local runs. CI already prints, for every example on every run, how long it took and a digest of its verified output. Those lines were read from the six most recent successful examples jobs whose logs were still available (a seventh could not be fetched). For each run's merge commit, git's identifier of each example's generated Lean, its Lean version file and its pinned Lean packages was computed. That triple is "the product".

### Result

| | |
|---|---|
| Runs | 6, each on a different compiler source tree |
| Examples compared | 24 with more than one run |
| Examples whose product was identical in every run | 11 |
| Examples whose verified digest was identical in any two runs | 0 |

Every example's verified digest differed in every run, including the eleven whose product never changed. **The premise is false for LexLean as built.** The verified output is a function of the product and of something else that changed in every run. The compiler's source differed in all six, and the project's own notes say a compiler identity is computed from committed language data, so that identity is the likely cause. I did not confirm it, and with no two runs sharing a compiler I cannot rule out other causes.

### What follows

- **Keying the whole verification by the product would reuse wrongly.** The recorded result would not be the one a fresh run produces.
- **There is nothing to run it with either.** LexLean's command for an example formats, locks, checks, builds and verifies in one process. No entry point verifies an existing product.
- **The repeated work is real, but it is inside the verifier.** Lean elaborating an unchanged module with an unchanged Lean is the same work each time. Sparing it means the verifier keeping elaboration results by module content, then stamping the current compiler's identity on its output. That is a change to LexLean, for its maintainers, and its specification currently forbids carrying anything between runs.
- **Size of the prize, from CI's records:** the examples took 4,060 seconds a run on average across these six, the largest being `bootstrap` at about 31 minutes a run. If results were reusable by product, 59 percent of that would have been spared across the six runs. That figure is arithmetic on a premise now shown false; it is recorded as the upper bound a verifier-level cache could approach, not as a result.

### What was not done

- The Atlas shards were not run. They need more memory and disk than this machine can give safely, and the premise they would have tested failed on the cheaper data.
- Whether pass or fail, as opposed to the output bytes, is determined by the product alone was not tested. Every run in the sample passed.
