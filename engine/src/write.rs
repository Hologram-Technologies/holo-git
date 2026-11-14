//! Writing git objects, packfiles and bundles.

use crate::object::open_envelope;
use crate::{hex, sha1, Error, Id, Kind};
use miniz_oxide::deflate::compress_to_vec_zlib;

pub struct NewEntry<'a> {
    pub mode: &'a [u8],
    pub name: &'a [u8],
    pub id: Id,
}

/// Git orders tree entries by name, with a directory compared as if its name ended in `/`.
fn sort_key<'a>(entry: &'a NewEntry<'a>) -> impl Iterator<Item = u8> + 'a {
    let directory = entry.mode == b"40000";
    entry.name.iter().copied().chain(directory.then_some(b'/'))
}

/// The content of a tree object. Entries may arrive in any order.
pub fn build_tree(mut entries: Vec<NewEntry<'_>>) -> Result<Vec<u8>, Error> {
    for entry in &entries {
        let bad_name = entry.name.is_empty() || entry.name.contains(&b'/') || entry.name.contains(&0) || entry.name == b"." || entry.name == b".." || entry.name == b".git";
        let bad_mode = entry.mode.is_empty() || !entry.mode.iter().all(|b| (b'0'..=b'7').contains(b));
        if bad_name || bad_mode {
            return Err(Error::BadObject);
        }
    }
    entries.sort_by(|a, b| sort_key(a).cmp(sort_key(b)));
    for pair in entries.windows(2) {
        if pair[0].name == pair[1].name {
            return Err(Error::BadObject);
        }
    }
    let mut out = Vec::new();
    for entry in &entries {
        out.extend_from_slice(entry.mode);
        out.push(b' ');
        out.extend_from_slice(entry.name);
        out.push(0);
        out.extend_from_slice(&entry.id);
    }
    Ok(out)
}

fn single_line(value: &[u8]) -> Result<(), Error> {
    if value.is_empty() || value.contains(&b'\n') || value.contains(&0) {
        return Err(Error::BadObject);
    }
    Ok(())
}

/// The content of a commit object. `tree` and `parents` are 40-character hex identifiers;
/// `author` and `committer` are full identity lines (`Name <email> seconds +zone`).
pub fn build_commit(tree: &[u8], parents: &[&[u8]], author: &[u8], committer: &[u8], message: &[u8]) -> Result<Vec<u8>, Error> {
    let is_id = |value: &[u8]| value.len() == 40 && value.iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b));
    if !is_id(tree) || !parents.iter().all(|p| is_id(p)) || message.contains(&0) {
        return Err(Error::BadObject);
    }
    single_line(author)?;
    single_line(committer)?;
    let mut out = Vec::new();
    out.extend_from_slice(b"tree ");
    out.extend_from_slice(tree);
    out.push(b'\n');
    for parent in parents {
        out.extend_from_slice(b"parent ");
        out.extend_from_slice(parent);
        out.push(b'\n');
    }
    out.extend_from_slice(b"author ");
    out.extend_from_slice(author);
    out.extend_from_slice(b"\ncommitter ");
    out.extend_from_slice(committer);
    out.extend_from_slice(b"\n\n");
    out.extend_from_slice(message);
    Ok(out)
}

/// A packfile holding the given envelopes, undeltified. Any git can index it.
pub fn write_pack(envelopes: &[&[u8]]) -> Result<Vec<u8>, Error> {
    let mut out = Vec::new();
    out.extend_from_slice(b"PACK");
    out.extend_from_slice(&2u32.to_be_bytes());
    out.extend_from_slice(&(envelopes.len() as u32).to_be_bytes());
    for envelope in envelopes {
        let (kind, content) = open_envelope(envelope)?;
        let mut size = content.len();
        let mut first = ((kind as u8) << 4) | (size & 15) as u8;
        size >>= 4;
        while size > 0 {
            out.push(first | 0x80);
            first = (size & 0x7f) as u8;
            size >>= 7;
        }
        out.push(first);
        out.extend_from_slice(&compress_to_vec_zlib(content, 6));
    }
    let checksum = sha1(&out);
    out.extend_from_slice(&checksum);
    Ok(out)
}

/// A version 2 git bundle: the named refs, then a pack with everything they need.
pub fn write_bundle(refs: &[(&[u8], Id)], envelopes: &[&[u8]]) -> Result<Vec<u8>, Error> {
    let mut out = b"# v2 git bundle\n".to_vec();
    for (name, id) in refs {
        single_line(name)?;
        if name.contains(&b' ') {
            return Err(Error::BadObject);
        }
        out.extend_from_slice(hex(id).as_bytes());
        out.push(b' ');
        out.extend_from_slice(name);
        out.push(b'\n');
    }
    out.push(b'\n');
    out.extend_from_slice(&write_pack(envelopes)?);
    Ok(out)
}

/// `"<kind> <len>\0<content>"` for a kind and its content.
pub fn envelope(kind: Kind, content: &[u8]) -> Vec<u8> {
    let mut out = crate::envelope_header(kind, content.len());
    out.extend_from_slice(content);
    out
}
