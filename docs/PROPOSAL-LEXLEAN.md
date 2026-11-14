# Draft proposal for LexLean: hear about a first-stage failure before the push

Status: a draft. It has not been sent to anyone or posted anywhere.

## The problem, from LexLean's own CI records

Of the 43 most recent completed pull request runs, 31 ended at the first stage (`honesty`). Twelve of those failed it. For those twelve:

| | |
|---|---|
| Time from the run starting to the failing verdict, median | 65.9 minutes |
| Time the stage itself ran, median | 2.2 minutes |
| Share of the wait spent before the stage started | 96 percent |

What failed, read from each log:

| Cause | Runs |
|---|---|
| Generated files not regenerated (`cargo xtask check-freshness`) | 9 |
| Formatting (`just fmt-check`) | 2 |
| A stale generated document (`just model`) | 1 |

Every one is a step the author forgot, and every one is reported by a command that takes about two minutes on a developer machine.

## The proposal

Run the first stage's own steps before a push leaves the author's machine.

1. **A recipe that is the first stage.** One `just` recipe that runs what the `honesty` job runs, in its order, so CI and a developer run the same thing by the same name:

   ```
   honesty: 
       python3 -m unittest discover -s .github/scripts -p 'test_intel_host_tests.py'
       python3 -m unittest discover -s .github/scripts -p 'test_host_lanes.py'
       cargo xtask check-freshness
       LEXLEAN_BDD_PART=honesty just fmt-check model spec-links bdd
   ```

   The CI job would then call this recipe. This step alone is worth having: today the stage's steps exist only in the workflow file.

2. **An optional pre-push hook** that runs it and refuses the push on failure. Opt-in per developer; `git push --no-verify` skips it.

Nothing in the gate changes. CI still runs every stage from a clean checkout, as SPEC §9.4 requires. This only moves the first answer earlier.

## Evidence that it works

The first stage's steps were run on the exact merge commits CI tested in those twelve runs, on one developer machine (Linux, 12 cores, the pinned toolchain), with a warm build directory.

- **Same answer.** All twelve failed at the same step for the same reason as in CI. One count differs by one (183 stale files against CI's 184); not explained.
- **Time to the verdict.** Median 129 seconds, against 65.9 minutes: 29 times sooner at the median, between 5 and 669 times. In total, 24.7 minutes against 716.
- **The work is the same.** The stage takes about as long locally as on the runner. The whole gain is not waiting.

Limits: one machine, one day, twelve commits, no repeats for variance. A cold build of the stage took about five minutes. The hardware-instruction probe that one pull request adds to the stage was not run. A replay cannot show whether authors would use it.

Method and per-run figures: `docs/BENCHMARK.md` in `humuhumu33/holo-git`.

## What this does not need

It does not need holo-git. A `just` recipe and a four-line hook give most of the gain above. That is the recommendation.

What holo-git's check command adds, if wanted later:

- **It checks the commit being pushed**, in a directory holding only committed files, not the working tree with its uncommitted edits. A hook that checks the working tree passes when files were regenerated but not committed; this one does not. Whether that happened in any of the twelve runs is not known.
- **A repeat costs nothing.** The same content checked again takes half a second, so pushing a rebase or a second remote does not pay twice.
- **A result can travel.** Signed by the author's machine, it could let CI skip a stage already passed for that exact content. That would cross runs, which §9.4 forbids today, so it is a decision for the maintainers and not part of this proposal.

Using it requires a checkout of holo-git beside LexLean and a definitions file; nothing would be committed to LexLean unless the maintainers chose to.

## Two observations, offered without a request

- **Runs wait before they start.** The first leg of a run began a median 21 minutes after the run was created, and up to 70. The cause was not confirmed.
- **Example verification repeats Lean's work.** Across six successful runs, eleven examples had identical generated Lean throughout, yet each was verified again in full every time, and its verified output differed every time, presumably because it carries the compiler's identity. The repeated part is Lean elaborating unchanged modules. Sparing it would mean a cache inside the verifier, keyed by module content and Lean version. The examples took about 68 minutes a run in that sample. This too would carry something between runs.

## What is asked

A decision on step 1 (the recipe) and step 2 (the optional hook). Both are small, both are reversible, and neither touches the gate.
