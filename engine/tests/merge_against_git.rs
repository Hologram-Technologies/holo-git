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

/// What git makes of the same three files: the bytes it prints, and whether it was clean.
fn git_merge(dir: &PathBuf, base: &[u8], ours: &[u8], theirs: &[u8]) -> (Vec<u8>, bool) {
    std::fs::write(dir.join("base"), base).unwrap();
    std::fs::write(dir.join("ours"), ours).unwrap();
    std::fs::write(dir.join("theirs"), theirs).unwrap();
    let output = Command::new("git").current_dir(dir).args(["merge-file", "-p", "ours", "base", "theirs"]).output().expect("git runs");
    match output.status.code() {
        Some(0) => (output.stdout, true),
        Some(code) if code > 0 => (output.stdout, false),
        other => panic!("git merge-file failed: {:?}", other),
    }
}

/// Git's merge of the files already written, resolving every conflict in favour of one side.
fn git_favouring(dir: &PathBuf, side: &str) -> Vec<u8> {
    let output = Command::new("git").current_dir(dir).args(["merge-file", "-p", side, "ours", "base", "theirs"]).output().expect("git runs");
    assert_eq!(output.status.code(), Some(0));
    output.stdout
}

/// Resolve a marked text by taking one side of every disputed region.
fn take(marked: &[u8], ours: bool) -> Vec<u8> {
    let mut out = Vec::new();
    let mut state = 0; // 0 outside, 1 in our side, 2 in their side
    for line in marked.split_inclusive(|b| *b == b'\n') {
        if line == b"<<<<<<< ours
" {
            state = 1;
        } else if state == 1 && line == b"=======
" {
            state = 2;
        } else if state == 2 && line == b">>>>>>> theirs
" {
            state = 0;
        } else if state == 0 || (state == 1) == ours {
            out.extend_from_slice(line);
        }
    }
    out
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
fn a_conflict_is_shown_as_git_shows_it() {
    let dir = scratch("marked");
    let base = b"a
b
c
d
e
";
    for (ours, theirs) in [
        (&b"a
b
X
d
e
"[..], &b"a
b
Y
d
e
"[..]),
        (&b"a
b
X
d
e
"[..], &b"a
b
c
Y
e
"[..]),
        (&b"a
b
d
e
"[..], &b"a
b
C
d
e
"[..]),
        (&b"a
b
c
d
e
ours
"[..], &b"a
b
c
d
e
theirs
"[..]),
        (&b"A
b
c
d
E1
"[..], &b"a
b
c
d
E2
"[..]),
    ] {
        let mine = merge(base, ours, theirs);
        let (gits, clean) = git_merge(&dir, base, ours, theirs);
        assert!(!clean && mine.conflicts > 0);
        assert_eq!(String::from_utf8_lossy(&mine.bytes), String::from_utf8_lossy(&gits));
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn whatever_we_call_clean_git_calls_clean_with_the_same_bytes() {
    let dir = scratch("random");
    let mut random = Random(23);
    let (mut ours_clean, mut git_clean, mut both_clean) = (0u32, 0u32, 0u32);
    let (mut marked_total, mut marked_same) = (0u32, 0u32);
    let cases = 600;
    for case in 0..cases {
        let length = 12 + random.next(60) as usize;
        let base: Vec<String> = (0..length).map(|i| format!("base line {} {}\n", i, random.next(4))).collect();
        // Mostly disjoint regions, sometimes overlapping, so both outcomes are exercised.
        let split = length / 2;
        let overlap = if random.next(3) == 0 { length / 3 } else { 0 };
        let ours = edit(&mut random, &base, "ours", 0, split + overlap);
        let theirs = edit(&mut random, &base, "theirs", split.saturating_sub(overlap), length);
        let (b, o, t) = (base.concat().into_bytes(), ours.concat().into_bytes(), theirs.concat().into_bytes());

        let mine = merge(&b, &o, &t);
        let (gits, git_was_clean) = git_merge(&dir, &b, &o, &t);
        if git_was_clean {
            git_clean += 1;
        }
        if mine.conflicts == 0 {
            ours_clean += 1;
            assert!(git_was_clean, "case {}: we merged cleanly where git reports a conflict", case);
            assert_eq!(mine.bytes, gits, "case {}: clean merge differs from git's", case);
            both_clean += 1;
        } else {
            // Taking one side of every disputed region must give what git gives when told to favour that side.
            assert_eq!(take(&mine.bytes, true), git_favouring(&dir, "--ours"), "case {}: taking ours everywhere differs from git --ours", case);
            assert_eq!(take(&mine.bytes, false), git_favouring(&dir, "--theirs"), "case {}: taking theirs everywhere differs from git --theirs", case);
            if !git_was_clean {
                marked_total += 1;
                if mine.bytes == gits {
                    marked_same += 1;
                }
            }
        }
    }
    println!("cases {}, git clean {}, engine clean {}, both {}; conflicts in both {}, marked identically {}", cases, git_clean, ours_clean, both_clean, marked_total, marked_same);
    assert!(git_clean > cases / 3 && git_clean < cases, "the cases exercise both outcomes");
    assert!(both_clean * 10 >= git_clean * 9, "the engine resolves at least nine in ten of what git resolves ({} of {})", both_clean, git_clean);
    let _ = std::fs::remove_dir_all(&dir);
}
