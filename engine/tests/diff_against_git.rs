//! Diff and blame are tested against git: the diff must rebuild the new file exactly and be
//! as short as `git diff --minimal`; blame must name the same commit per line as `git blame`.

use holo_git_engine::diff::{blame, diff, lines, Op};
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> (bool, Vec<u8>) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"])
        .args(args)
        .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00Z")
        .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:00Z")
        .output()
        .expect("git runs");
    (output.status.success(), output.stdout)
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("holo-git-diff-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A small deterministic generator, so the cases are the same on every run.
struct Random(u64);
impl Random {
    fn next(&mut self, bound: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % bound
    }
}

fn apply(old: &[u8], new: &[u8]) -> Vec<u8> {
    let old_lines = lines(old);
    let new_lines = lines(new);
    let (mut i, mut j) = (0usize, 0usize);
    let mut out = Vec::new();
    for (op, count) in diff(old, new) {
        for _ in 0..count {
            match op {
                Op::Equal => {
                    assert_eq!(old_lines[i], new_lines[j], "an equal run names equal lines");
                    out.extend_from_slice(old_lines[i]);
                    i += 1;
                    j += 1;
                }
                Op::Delete => i += 1,
                Op::Insert => {
                    out.extend_from_slice(new_lines[j]);
                    j += 1;
                }
            }
        }
    }
    assert_eq!((i, j), (old_lines.len(), new_lines.len()), "every line is accounted for");
    out
}

fn counts(old: &[u8], new: &[u8]) -> (u32, u32) {
    let mut added = 0;
    let mut removed = 0;
    for (op, count) in diff(old, new) {
        match op {
            Op::Insert => added += count,
            Op::Delete => removed += count,
            Op::Equal => {}
        }
    }
    (added, removed)
}

#[test]
fn diff_rebuilds_and_is_as_short_as_git() {
    let dir = scratch("minimal");
    let mut random = Random(7);
    let mut cases: Vec<(Vec<u8>, Vec<u8>)> = vec![
        (b"".to_vec(), b"".to_vec()),
        (b"".to_vec(), b"a\nb\n".to_vec()),
        (b"a\nb\n".to_vec(), b"".to_vec()),
        (b"a\nb\nc\n".to_vec(), b"a\nb\nc\n".to_vec()),
        (b"a\nb\nc".to_vec(), b"a\nb\nc\n".to_vec()),
        (b"a\nb\nc\na\nb\nb\na\n".to_vec(), b"c\nb\na\nb\na\nc\n".to_vec()),
    ];
    for _ in 0..60 {
        let length = 1 + random.next(120) as usize;
        let alphabet = 3 + random.next(40);
        let old: Vec<String> = (0..length).map(|_| format!("line {}\n", random.next(alphabet))).collect();
        let mut new = old.clone();
        for _ in 0..random.next(30) {
            let at = random.next(new.len() as u64 + 1) as usize;
            match random.next(3) {
                0 if !new.is_empty() => {
                    new.remove(at.min(new.len() - 1));
                }
                1 => new.insert(at, format!("line {}\n", random.next(alphabet))),
                _ if !new.is_empty() => {
                    let i = at.min(new.len() - 1);
                    new[i] = format!("changed {}\n", random.next(alphabet));
                }
                _ => {}
            }
        }
        cases.push((old.concat().into_bytes(), new.concat().into_bytes()));
    }

    for (index, (old, new)) in cases.iter().enumerate() {
        assert_eq!(&apply(old, new), new, "case {} rebuilds the new file", index);
        std::fs::write(dir.join("old"), old).unwrap();
        std::fs::write(dir.join("new"), new).unwrap();
        let (_, out) = git(&dir, &["diff", "--no-index", "--minimal", "--numstat", "old", "new"]);
        let text = String::from_utf8(out).unwrap();
        let expected = match text.split_whitespace().collect::<Vec<_>>().as_slice() {
            [added, removed, ..] => (added.parse().unwrap(), removed.parse().unwrap()),
            _ => (0, 0),
        };
        assert_eq!(counts(old, new), expected, "case {} is as short as git's minimal diff", index);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn very_different_files_still_rebuild() {
    let old: Vec<u8> = (0..3000).flat_map(|i| format!("old {}\n", i).into_bytes()).collect();
    let new: Vec<u8> = (0..3000).flat_map(|i| format!("new {}\n", i).into_bytes()).collect();
    assert_eq!(apply(&old, &new), new);
}

#[test]
fn blame_names_the_same_commit_as_git() {
    let dir = scratch("blame");
    assert!(git(&dir, &["init", "-q", "-b", "main"]).0);
    let mut random = Random(11);
    let mut serial = 0u32;
    let mut fresh = || {
        serial += 1;
        format!("unique line {}\n", serial)
    };
    let mut content: Vec<String> = (0..40).map(|_| fresh()).collect();
    let mut versions: Vec<Vec<u8>> = Vec::new();
    let mut commits: Vec<String> = Vec::new();
    for round in 0..25 {
        if round > 0 {
            for _ in 0..1 + random.next(6) {
                let at = random.next(content.len() as u64) as usize;
                match random.next(3) {
                    0 if content.len() > 5 => {
                        content.remove(at);
                    }
                    1 => content.insert(at, fresh()),
                    _ => content[at] = fresh(),
                }
            }
        }
        let bytes = content.concat().into_bytes();
        std::fs::write(dir.join("file.txt"), &bytes).unwrap();
        assert!(git(&dir, &["add", "-A"]).0);
        assert!(git(&dir, &["commit", "-q", "--allow-empty", "-m", &format!("round {}", round)]).0);
        commits.push(String::from_utf8(git(&dir, &["rev-parse", "HEAD"]).1).unwrap().trim().to_string());
        versions.push(bytes);
    }
    versions.reverse();
    commits.reverse();
    let slices: Vec<&[u8]> = versions.iter().map(Vec::as_slice).collect();
    let ours: Vec<&str> = blame(&slices).into_iter().map(|index| commits[index as usize].as_str()).collect();

    let (ok, out) = git(&dir, &["blame", "-l", "-s", "--root", "--minimal", "file.txt"]);
    assert!(ok);
    let text = String::from_utf8(out).unwrap();
    let theirs: Vec<&str> = text.lines().map(|line| &line[..40]).collect();
    assert_eq!(ours.len(), theirs.len(), "line count");
    assert_eq!(ours, theirs);
    assert!(theirs.iter().collect::<std::collections::HashSet<_>>().len() > 8, "the fixture spreads lines over many commits");
    let _ = std::fs::remove_dir_all(&dir);
}
