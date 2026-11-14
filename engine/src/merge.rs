//! Three-way merge of text, line by line.
//!
//! The rule is the conservative one: a base line that both sides kept is an anchor. Between two
//! anchors, if only one side changed the lines, that side's lines are taken; if both changed them
//! to the same thing, that is taken; otherwise it is a conflict. Changes to adjacent lines fall
//! between the same anchors and so conflict, as they do in git.

use crate::diff::{diff, lines, Op};

/// For each base line, the index of the line it survived as in the other version, if it did.
fn survivors(base: &[u8], other: &[u8], count: usize) -> Vec<Option<usize>> {
    let mut map = vec![None; count];
    let (mut b, mut o) = (0usize, 0usize);
    for (op, run) in diff(base, other) {
        let run = run as usize;
        match op {
            Op::Equal => {
                for k in 0..run {
                    map[b + k] = Some(o + k);
                }
                b += run;
                o += run;
            }
            Op::Delete => b += run,
            Op::Insert => o += run,
        }
    }
    map
}

pub struct Merged {
    pub bytes: Vec<u8>,
    pub conflicts: u32,
}

/// Merge `ours` and `theirs`, which both descend from `base`. When `conflicts` is not zero,
/// `bytes` holds our side for each conflicting region and must not be used as a result.
pub fn merge(base: &[u8], ours: &[u8], theirs: &[u8]) -> Merged {
    let b = lines(base);
    let o = lines(ours);
    let t = lines(theirs);
    let in_ours = survivors(base, ours, b.len());
    let in_theirs = survivors(base, theirs, b.len());

    let mut out = Vec::with_capacity(ours.len().max(theirs.len()));
    let mut conflicts = 0u32;
    let (mut bi, mut oi, mut ti) = (0usize, 0usize, 0usize);
    let mut resolve = |base_chunk: &[&[u8]], our_chunk: &[&[u8]], their_chunk: &[&[u8]], out: &mut Vec<u8>| {
        let chosen = if our_chunk == base_chunk {
            their_chunk
        } else if their_chunk == base_chunk || our_chunk == their_chunk {
            our_chunk
        } else {
            conflicts += 1;
            our_chunk
        };
        for line in chosen {
            out.extend_from_slice(line);
        }
    };
    for anchor in 0..b.len() {
        let (Some(ours_at), Some(theirs_at)) = (in_ours[anchor], in_theirs[anchor]) else { continue };
        resolve(&b[bi..anchor], &o[oi..ours_at], &t[ti..theirs_at], &mut out);
        out.extend_from_slice(b[anchor]);
        bi = anchor + 1;
        oi = ours_at + 1;
        ti = theirs_at + 1;
    }
    resolve(&b[bi..], &o[oi..], &t[ti..], &mut out);
    Merged { bytes: out, conflicts }
}
