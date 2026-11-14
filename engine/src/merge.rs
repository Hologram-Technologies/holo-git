//! Three-way merge of text, line by line.
//!
//! The rule is the conservative one: a base line that both sides kept is an anchor. Between two
//! anchors, if only one side changed the lines, that side's lines are taken; if both changed them
//! to the same thing, that is taken; otherwise it is a conflict. Changes to adjacent lines fall
//! between the same anchors and so conflict, as they do in git.
//!
//! Inside a conflict, lines both sides agree on at its start and end are not in dispute and are
//! taken, so the marked region is as small as the disagreement.

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

enum Region<'a> {
    Settled(Vec<&'a [u8]>),
    Disputed { ours: Vec<&'a [u8]>, theirs: Vec<&'a [u8]> },
}

fn settle<'a>(regions: &mut Vec<Region<'a>>, base: &[&'a [u8]], ours: &[&'a [u8]], theirs: &[&'a [u8]]) {
    if ours == base {
        regions.push(Region::Settled(theirs.to_vec()));
    } else if theirs == base || ours == theirs {
        regions.push(Region::Settled(ours.to_vec()));
    } else {
        let mut head = 0;
        while head < ours.len() && head < theirs.len() && ours[head] == theirs[head] {
            head += 1;
        }
        let mut tail = 0;
        while tail < ours.len() - head && tail < theirs.len() - head && ours[ours.len() - 1 - tail] == theirs[theirs.len() - 1 - tail] {
            tail += 1;
        }
        regions.push(Region::Settled(ours[..head].to_vec()));
        regions.push(Region::Disputed { ours: ours[head..ours.len() - tail].to_vec(), theirs: theirs[head..theirs.len() - tail].to_vec() });
        regions.push(Region::Settled(ours[ours.len() - tail..].to_vec()));
    }
}

fn plan<'a>(base: &'a [u8], ours: &'a [u8], theirs: &'a [u8]) -> Vec<Region<'a>> {
    let b = lines(base);
    let o = lines(ours);
    let t = lines(theirs);
    let in_ours = survivors(base, ours, b.len());
    let in_theirs = survivors(base, theirs, b.len());
    let mut regions = Vec::new();
    let (mut bi, mut oi, mut ti) = (0usize, 0usize, 0usize);
    for anchor in 0..b.len() {
        let (Some(ours_at), Some(theirs_at)) = (in_ours[anchor], in_theirs[anchor]) else { continue };
        settle(&mut regions, &b[bi..anchor], &o[oi..ours_at], &t[ti..theirs_at]);
        regions.push(Region::Settled(vec![b[anchor]]));
        bi = anchor + 1;
        oi = ours_at + 1;
        ti = theirs_at + 1;
    }
    settle(&mut regions, &b[bi..], &o[oi..], &t[ti..]);
    regions
}

pub struct Merged {
    pub bytes: Vec<u8>,
    pub conflicts: u32,
}

pub const OURS_MARKER: &[u8] = b"<<<<<<< ours\n";
pub const SPLIT_MARKER: &[u8] = b"=======\n";
pub const THEIRS_MARKER: &[u8] = b">>>>>>> theirs\n";

fn push_side(out: &mut Vec<u8>, side: &[&[u8]]) {
    for line in side {
        out.extend_from_slice(line);
    }
    if out.last().is_some_and(|last| *last != b'\n') {
        out.push(b'\n'); // a final line without a newline must not swallow the marker after it
    }
}

/// Merge `ours` and `theirs`, which both descend from `base`.
///
/// With no conflicts, `bytes` is the merged text. With conflicts, `bytes` is the text with each
/// disputed region shown between markers, both sides in full, for a person to resolve.
pub fn merge(base: &[u8], ours: &[u8], theirs: &[u8]) -> Merged {
    let mut out = Vec::with_capacity(ours.len().max(theirs.len()));
    let mut conflicts = 0u32;
    for region in plan(base, ours, theirs) {
        match region {
            Region::Settled(kept) => {
                for line in kept {
                    out.extend_from_slice(line);
                }
            }
            Region::Disputed { ours, theirs } => {
                conflicts += 1;
                if out.last().is_some_and(|last| *last != b'\n') {
                    out.push(b'\n');
                }
                out.extend_from_slice(OURS_MARKER);
                push_side(&mut out, &ours);
                out.extend_from_slice(SPLIT_MARKER);
                push_side(&mut out, &theirs);
                out.extend_from_slice(THEIRS_MARKER);
            }
        }
    }
    Merged { bytes: out, conflicts }
}
