//! Git objects, packfiles and deltas.
//!
//! Every object identifier this crate returns is computed here from the
//! object's bytes. Nothing is taken on trust from the source of the bytes.

pub mod abi;
pub mod diff;
pub mod object;
pub mod pack;

use sha1::{Digest, Sha1};

pub type Id = [u8; 20];

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Truncated,
    BadMagic,
    BadVersion,
    BadChecksum,
    BadEntryType,
    BadZlib,
    BadDelta,
    MissingBase,
    BadObject,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Commit = 1,
    Tree = 2,
    Blob = 3,
    Tag = 4,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Commit => "commit",
            Kind::Tree => "tree",
            Kind::Blob => "blob",
            Kind::Tag => "tag",
        }
    }

    pub fn from_name(name: &[u8]) -> Option<Kind> {
        match name {
            b"commit" => Some(Kind::Commit),
            b"tree" => Some(Kind::Tree),
            b"blob" => Some(Kind::Blob),
            b"tag" => Some(Kind::Tag),
            _ => None,
        }
    }
}

/// The header git hashes in front of an object's content.
pub fn envelope_header(kind: Kind, len: usize) -> Vec<u8> {
    let mut header = Vec::with_capacity(16);
    header.extend_from_slice(kind.name().as_bytes());
    header.push(b' ');
    header.extend_from_slice(len.to_string().as_bytes());
    header.push(0);
    header
}

/// The object identifier: SHA-1 of the envelope header followed by the content.
pub fn object_id(kind: Kind, content: &[u8]) -> Id {
    let mut hasher = Sha1::new();
    hasher.update(envelope_header(kind, content.len()));
    hasher.update(content);
    hasher.finalize().into()
}

pub fn sha1(bytes: &[u8]) -> Id {
    Sha1::digest(bytes).into()
}

pub fn hex(id: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(id.len() * 2);
    for byte in id {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 15) as usize] as char);
    }
    out
}
