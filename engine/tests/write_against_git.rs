//! What the engine writes, git must accept and name identically.

use holo_git_engine::object::parse_tree;
use holo_git_engine::pack::read_pack;
use holo_git_engine::write::{build_commit, build_tree, envelope, write_bundle, write_pack, NewEntry};
use holo_git_engine::{hex, object_id, Error, Kind};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const WHO: &str = "Test <test@example.com> 1767225600 +0000";

fn git_in(dir: &Path, args: &[&str], input: Option<&[u8]>) -> (bool, Vec<u8>) {
    let mut child = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"])
        .args(args)
        .env("GIT_AUTHOR_DATE", "1767225600 +0000")
        .env("GIT_COMMITTER_DATE", "1767225600 +0000")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("git runs");
    if let Some(bytes) = input {
        child.stdin.take().unwrap().write_all(bytes).unwrap();
    }
    let output = child.wait_with_output().unwrap();
    (output.status.success(), output.stdout)
}

fn git(dir: &Path, args: &[&str]) -> String {
    let (ok, out) = git_in(dir, args, None);
    assert!(ok, "git {:?}", args);
    String::from_utf8(out).unwrap().trim().to_string()
}

fn repository(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("holo-git-write-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("a")).unwrap();
    std::fs::create_dir_all(dir.join("lib/deep")).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    // Names chosen so that the directory rule in git's ordering matters.
    for (path, text) in [("a/inner.txt", "inner\n"), ("a-b", "dash\n"), ("a.txt", "dot\n"), ("a0", "zero\n"), ("lib/deep/x.rs", "fn x() {}\n"), ("lib.rs", "mod deep;\n"), ("README.md", "# Title\n")] {
        std::fs::write(dir.join(path), text).unwrap();
    }
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "first"]);
    std::fs::write(dir.join("README.md"), "# Title\n\nMore.\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "second"]);
    dir
}

fn raw(id: &str) -> [u8; 20] {
    let mut out = [0u8; 20];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&id[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

#[test]
fn blobs_trees_and_commits_get_gits_identifiers() {
    let dir = repository("ids");

    let blob = b"# Title\n\nMore.\n";
    assert_eq!(hex(&object_id(Kind::Blob, blob)), git(&dir, &["rev-parse", "HEAD:README.md"]));

    for tree_name in ["HEAD^{tree}", "HEAD:lib", "HEAD:a"] {
        let tree_id = git(&dir, &["rev-parse", tree_name]);
        let (_, expected) = git_in(&dir, &["cat-file", "tree", &tree_id], None);
        let parsed = parse_tree(&expected).unwrap();
        // Hand the entries over in reverse; the engine must restore git's order.
        let entries: Vec<NewEntry> = parsed.iter().rev().map(|e| NewEntry { mode: e.mode, name: e.name, id: e.id }).collect();
        let built = build_tree(entries).unwrap();
        assert_eq!(built, expected, "tree bytes of {}", tree_name);
        assert_eq!(hex(&object_id(Kind::Tree, &built)), tree_id);
    }

    let tree = git(&dir, &["rev-parse", "HEAD^{tree}"]);
    let parent = git(&dir, &["rev-parse", "HEAD"]);
    let message = b"third\n\nwith a body\n";
    let content = build_commit(tree.as_bytes(), &[parent.as_bytes()], WHO.as_bytes(), WHO.as_bytes(), message).unwrap();
    let (ok, out) = git_in(&dir, &["commit-tree", &tree, "-p", &parent], Some(message));
    assert!(ok);
    assert_eq!(hex(&object_id(Kind::Commit, &content)), String::from_utf8(out).unwrap().trim());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bad_trees_and_commits_are_refused() {
    let id = [7u8; 20];
    let entry = |mode: &'static [u8], name: &'static [u8]| NewEntry { mode, name, id };
    assert_eq!(build_tree(vec![entry(b"100644", b"a/b")]).err(), Some(Error::BadObject), "a slash in a name");
    assert_eq!(build_tree(vec![entry(b"100644", b".git")]).err(), Some(Error::BadObject), "a .git entry");
    assert_eq!(build_tree(vec![entry(b"100644", b"..")]).err(), Some(Error::BadObject));
    assert_eq!(build_tree(vec![entry(b"100644", b"x"), entry(b"100644", b"x")]).err(), Some(Error::BadObject), "a duplicate name");
    assert_eq!(build_tree(vec![entry(b"10x644", b"x")]).err(), Some(Error::BadObject), "a bad mode");
    let tree = b"0000000000000000000000000000000000000000";
    assert!(build_commit(tree, &[], b"A <a@b> 1 +0000\ninjected header", WHO.as_bytes(), b"m\n").is_err(), "a newline in an identity");
    assert!(build_commit(b"short", &[], WHO.as_bytes(), WHO.as_bytes(), b"m\n").is_err());
}

#[test]
fn git_accepts_our_pack_and_bundle() {
    let dir = repository("pack");
    git(&dir, &["repack", "-a", "-d", "-q"]);
    let packs = dir.join(".git/objects/pack");
    let path = std::fs::read_dir(packs).unwrap().map(|e| e.unwrap().path()).find(|p| p.extension().is_some_and(|e| e == "pack")).unwrap();
    let objects = read_pack(&std::fs::read(path).unwrap()).unwrap();
    let envelopes: Vec<Vec<u8>> = objects.iter().map(|o| envelope(o.kind, &o.data)).collect();
    let slices: Vec<&[u8]> = envelopes.iter().map(Vec::as_slice).collect();

    // Round trip through our own reader.
    let pack = write_pack(&slices).unwrap();
    let again = read_pack(&pack).unwrap();
    assert_eq!(again.len(), objects.len());
    assert!(again.iter().zip(&objects).all(|(a, b)| a.id == b.id && a.data == b.data));

    // A fresh repository indexes the pack strictly and finds nothing wrong.
    let fresh = dir.join("fresh");
    std::fs::create_dir_all(&fresh).unwrap();
    git(&fresh, &["init", "-q", "-b", "main"]);
    let (ok, _) = git_in(&fresh, &["index-pack", "--strict", "--stdin"], Some(&pack));
    assert!(ok, "git index-pack --strict accepts the pack");

    // A bundle of the same objects can be verified and cloned by git.
    let head = git(&dir, &["rev-parse", "HEAD"]);
    let bundle = write_bundle(&[(b"refs/heads/main", raw(&head)), (b"HEAD", raw(&head))], &slices).unwrap();
    let bundle_path = dir.join("out.bundle");
    std::fs::write(&bundle_path, &bundle).unwrap();
    let (ok, _) = git_in(&dir, &["bundle", "verify", bundle_path.to_str().unwrap()], None);
    assert!(ok, "git bundle verify");
    let clone = dir.join("clone");
    let (ok, _) = git_in(&dir, &["clone", "-q", bundle_path.to_str().unwrap(), clone.to_str().unwrap()], None);
    assert!(ok, "git clone from the bundle");
    assert_eq!(git(&clone, &["rev-parse", "HEAD"]), head);
    assert_eq!(std::fs::read(clone.join("lib/deep/x.rs")).unwrap(), b"fn x() {}\n");
    let (ok, _) = git_in(&clone, &["fsck", "--strict"], None);
    assert!(ok, "git fsck --strict on the clone");
    let _ = std::fs::remove_dir_all(&dir);
}
