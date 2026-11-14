//! The engine is tested against git itself: every object it reads from a real packfile
//! must have the identifier, kind and bytes that `git cat-file` reports.

use holo_git_engine::object::{inflate_loose, open_envelope, parse_commit, parse_tree};
use holo_git_engine::pack::read_pack;
use holo_git_engine::{hex, sha1, Error};
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"])
        .args(args)
        .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00Z")
        .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:00Z")
        .output()
        .expect("git runs");
    assert!(output.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&output.stderr));
    output.stdout
}

fn repository(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("holo-git-engine-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src/deep")).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    let mut big = String::new();
    for line in 0..4000 {
        big.push_str(&format!("line {} of a file large enough to be worth a delta\n", line));
    }
    for round in 0..12 {
        std::fs::write(dir.join("big.txt"), format!("{}round {}\n", big, round)).unwrap();
        std::fs::write(dir.join("src/deep/note.md"), format!("# Note\n\nround {}\n", round)).unwrap();
        std::fs::write(dir.join(format!("src/file{}.txt", round)), format!("file {}\n", round)).unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", &format!("round {}\n\nbody with \"quotes\" and a tab\t.", round)]);
    }
    git(&dir, &["tag", "-a", "v1", "-m", "first tag"]);
    dir
}

fn pack_of(dir: &Path) -> Vec<u8> {
    git(dir, &["repack", "-a", "-d", "-f", "-q", "--depth=20", "--window=20"]);
    let packs = dir.join(".git/objects/pack");
    let path = std::fs::read_dir(packs)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.extension().is_some_and(|e| e == "pack"))
        .expect("a pack");
    std::fs::read(path).unwrap()
}

#[test]
fn every_object_matches_git() {
    let dir = repository("match");
    let pack = pack_of(&dir);
    let objects = read_pack(&pack).expect("pack reads");

    let listing = String::from_utf8(git(&dir, &["cat-file", "--batch-all-objects", "--batch-check"])).unwrap();
    assert_eq!(objects.len(), listing.lines().count(), "object count");
    assert!(objects.len() > 60, "fixture is large enough");

    for object in &objects {
        let id = hex(&object.id);
        let kind = String::from_utf8(git(&dir, &["cat-file", "-t", &id])).unwrap();
        assert_eq!(kind.trim(), object.kind.name(), "kind of {}", id);
        let bytes = git(&dir, &["cat-file", object.kind.name(), &id]);
        assert_eq!(bytes, object.data, "bytes of {}", id);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn pack_contains_deltas() {
    let dir = repository("deltas");
    let pack = pack_of(&dir);
    let report = {
        let packs = dir.join(".git/objects/pack");
        let index = std::fs::read_dir(packs)
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| p.extension().is_some_and(|e| e == "idx"))
            .unwrap();
        String::from_utf8(git(&dir, &["verify-pack", "-v", index.to_str().unwrap()])).unwrap()
    };
    assert!(report.contains("chain length"), "the fixture exercises delta resolution:\n{}", report);
    assert!(read_pack(&pack).is_ok());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn commits_and_trees_parse() {
    let dir = repository("parse");
    let pack = pack_of(&dir);
    let objects = read_pack(&pack).unwrap();
    let head = String::from_utf8(git(&dir, &["rev-parse", "HEAD"])).unwrap();
    let commit = objects.iter().find(|o| hex(&o.id) == head.trim()).expect("head is in the pack");
    let parsed = parse_commit(&commit.data).unwrap();
    let tree_id = String::from_utf8(git(&dir, &["rev-parse", "HEAD^{tree}"])).unwrap();
    assert_eq!(std::str::from_utf8(parsed.tree).unwrap(), tree_id.trim());
    assert_eq!(parsed.parents.len(), 1);
    assert!(parsed.message.starts_with(b"round 11\n"));
    assert!(parsed.author.starts_with(b"Test <test@example.com>"));

    let tree = objects.iter().find(|o| hex(&o.id) == tree_id.trim()).unwrap();
    let names: Vec<String> = parse_tree(&tree.data).unwrap().iter().map(|e| String::from_utf8_lossy(e.name).into_owned()).collect();
    let expected = String::from_utf8(git(&dir, &["ls-tree", "--name-only", "HEAD"])).unwrap();
    assert_eq!(names, expected.lines().collect::<Vec<_>>());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn loose_objects_inflate_and_hash() {
    let dir = repository("loose");
    std::fs::write(dir.join("loose.txt"), "a loose object\n").unwrap();
    let id = String::from_utf8(git(&dir, &["hash-object", "-w", "loose.txt"])).unwrap();
    let id = id.trim();
    let path = dir.join(".git/objects").join(&id[..2]).join(&id[2..]);
    let envelope = inflate_loose(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(hex(&sha1(&envelope)), id);
    let (kind, content) = open_envelope(&envelope).unwrap();
    assert_eq!(kind.name(), "blob");
    assert_eq!(content, b"a loose object\n");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn damaged_packs_are_refused() {
    let dir = repository("damage");
    let pack = pack_of(&dir);

    let mut flipped = pack.clone();
    let middle = flipped.len() / 2;
    flipped[middle] ^= 0x01;
    assert_eq!(read_pack(&flipped).err(), Some(Error::BadChecksum), "one flipped bit");

    assert!(read_pack(&pack[..pack.len() - 1]).is_err(), "one byte short");
    assert_eq!(read_pack(b"NOPE").err(), Some(Error::Truncated));

    let mut magic = pack.clone();
    magic[0] = b'X';
    assert_eq!(read_pack(&magic).err(), Some(Error::BadMagic));
    let _ = std::fs::remove_dir_all(&dir);
}
