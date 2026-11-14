//! The merge is tested against `git merge-file`. The property that matters is soundness:
//! whenever the engine says a merge is clean, git must agree and produce the same bytes.
//! The engine may be more cautious than git; how often is measured and bounded.

use holo_git_engine::merge::merge;
use std::path::PathBuf;
use std::process::Command;

struct Random(u64);
impl Random {
    fn next(&mut self, bound: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % bound
    }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("holo-git-merge-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// What git makes of the same three files: `Some(bytes)` when clean, `None` on conflict.
fn git_merge(dir: &PathBuf, base: &[u8], ours: &[u8], theirs: &[u8]) -> Option<Vec<u8>> {
    std::fs::write(dir.join("base"), base).unwrap();
    std::fs::write(dir.join("ours"), ours).unwrap();
    std::fs::write(dir.join("theirs"), theirs).unwrap();
    let output = Command::new("git").current_dir(dir).args(["merge-file", "-p", "ours", "base", "theirs"]).output().expect("git runs");
    match output.status.code() {
        Some(0) => Some(output.stdout),
        Some(code) if code > 0 => None,
        other => panic!("git merge-file failed: {:?}", other),
    }
}

fn edit(random: &mut Random, lines: &[String], tag: &str, from: usize, to: usize) -> Vec<String> {
    let mut out = lines.to_vec();
    for _ in 0..1 + random.next(3) {
        if to <= from || out.is_empty() {
            break;
        }
        let at = (from + random.next((to - from) as u64) as usize).min(out.len() - 1);
        match random.next(3) {
            0 if out.len() > 3 => {
                out.remove(at);
            }
            1 => out.insert(at, format!("{} inserted {}\n", tag, random.next(1000))),
            _ => out[at] = format!("{} changed {}\n", tag, random.next(1000)),
        }
    }
    out
}

#[test]
fn directed_cases() {
    let base = b"a\nb\nc\nd\ne\nf\ng\n";
    // Changes far apart merge.
    let merged = merge(base, b"A\nb\nc\nd\ne\nf\ng\n", b"a\nb\nc\nd\ne\nf\nG\n");
    assert_eq!((merged.conflicts, merged.bytes.as_slice()), (0, b"A\nb\nc\nd\ne\nf\nG\n".as_slice()));
    // Only one side changed.
    assert_eq!(merge(base, base, b"a\nb\nX\nd\ne\nf\ng\n").bytes, b"a\nb\nX\nd\ne\nf\ng\n");
    assert_eq!(merge(base, b"a\nb\nX\nd\ne\nf\ng\n", base).bytes, b"a\nb\nX\nd\ne\nf\ng\n");
    // Both made the same change.
    let same = merge(base, b"a\nb\nX\nd\ne\nf\ng\n", b"a\nb\nX\nd\ne\nf\ng\n");
    assert_eq!((same.conflicts, same.bytes.as_slice()), (0, b"a\nb\nX\nd\ne\nf\ng\n".as_slice()));
    // Both changed the same line differently.
    assert_eq!(merge(base, b"a\nb\nX\nd\ne\nf\ng\n", b"a\nb\nY\nd\ne\nf\ng\n").conflicts, 1);
    // Changes to adjacent lines conflict.
    assert_eq!(merge(base, b"a\nb\nX\nd\ne\nf\ng\n", b"a\nb\nc\nY\ne\nf\ng\n").conflicts, 1);
    // One deletes what the other edits.
    assert_eq!(merge(base, b"a\nb\nd\ne\nf\ng\n", b"a\nb\nC\nd\ne\nf\ng\n").conflicts, 1);
    // Both append different endings.
    assert_eq!(merge(base, b"a\nb\nc\nd\ne\nf\ng\nours\n", b"a\nb\nc\nd\ne\nf\ng\ntheirs\n").conflicts, 1);
    // Empty inputs.
    assert_eq!(merge(b"", b"", b"").bytes, b"");
    assert_eq!(merge(b"", b"x\n", b"").bytes, b"x\n");
}

#[test]
fn whatever_we_call_clean_git_calls_clean_with_the_same_bytes() {
    let dir = scratch("random");
    let mut random = Random(23);
    let (mut ours_clean, mut git_clean, mut both_clean) = (0u32, 0u32, 0u32);
    let cases = 400;
    for case in 0..cases {
        let length = 12 + random.next(60) as usize;
        let base: Vec<String> = (0..length).map(|i| format!("base line {} {}\n", i, random.next(4))).collect();
        // Mostly disjoint regions, sometimes overlapping, so both outcomes are exercised.
        let split = length / 2;
        let overlap = if random.next(4) == 0 { length / 4 } else { 0 };
        let ours = edit(&mut random, &base, "ours", 0, split + overlap);
        let theirs = edit(&mut random, &base, "theirs", split.saturating_sub(overlap), length);
        let (b, o, t) = (base.concat().into_bytes(), ours.concat().into_bytes(), theirs.concat().into_bytes());

        let mine = merge(&b, &o, &t);
        let gits = git_merge(&dir, &b, &o, &t);
        if gits.is_some() {
            git_clean += 1;
        }
        if mine.conflicts == 0 {
            ours_clean += 1;
            let gits = gits.unwrap_or_else(|| panic!("case {}: we merged cleanly where git reports a conflict", case));
            assert_eq!(mine.bytes, gits, "case {}: clean merge differs from git's", case);
            both_clean += 1;
        }
    }
    println!("cases {}, git clean {}, engine clean {}, both {}", cases, git_clean, ours_clean, both_clean);
    assert!(git_clean > cases / 3 && git_clean < cases, "the cases exercise both outcomes");
    assert!(both_clean * 10 >= git_clean * 9, "the engine resolves at least nine in ten of what git resolves ({} of {})", both_clean, git_clean);
    let _ = std::fs::remove_dir_all(&dir);
}
