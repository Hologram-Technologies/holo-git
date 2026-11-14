//! Packfile reading and delta resolution.

use crate::{object_id, sha1, Error, Id, Kind};
use miniz_oxide::inflate::core::inflate_flags::{
    TINFL_FLAG_PARSE_ZLIB_HEADER, TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
};
use miniz_oxide::inflate::core::{decompress, DecompressorOxide};
use miniz_oxide::inflate::TINFLStatus;
use std::collections::HashMap;

pub struct Object {
    pub id: Id,
    pub kind: Kind,
    pub data: Vec<u8>,
}

enum Base {
    None(Kind),
    Offset(usize),
    Id(Id),
}

struct Entry {
    offset: usize,
    base: Base,
    data: Vec<u8>,
}

/// Inflate one zlib stream of known output size. Returns the bytes and how much input it used.
fn inflate_exact(input: &[u8], size: usize) -> Result<(Vec<u8>, usize), Error> {
    let mut out = vec![0u8; size];
    let mut state = DecompressorOxide::new();
    let flags = TINFL_FLAG_PARSE_ZLIB_HEADER | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF;
    let (status, used, written) = decompress(&mut state, input, &mut out, 0, flags);
    if status != TINFLStatus::Done || written != size {
        return Err(Error::BadZlib);
    }
    Ok((out, used))
}

fn byte(pack: &[u8], pos: &mut usize) -> Result<u8, Error> {
    let value = *pack.get(*pos).ok_or(Error::Truncated)?;
    *pos += 1;
    Ok(value)
}

fn delta_size(delta: &[u8], pos: &mut usize) -> Result<usize, Error> {
    let mut value = 0usize;
    let mut shift = 0u32;
    loop {
        let b = *delta.get(*pos).ok_or(Error::BadDelta)?;
        *pos += 1;
        if shift > 56 {
            return Err(Error::BadDelta);
        }
        value |= ((b & 0x7f) as usize) << shift;
        shift += 7;
        if b & 0x80 == 0 {
            return Ok(value);
        }
    }
}

/// Rebuild an object from its base and a delta.
pub fn apply_delta(base: &[u8], delta: &[u8]) -> Result<Vec<u8>, Error> {
    let mut pos = 0;
    if delta_size(delta, &mut pos)? != base.len() {
        return Err(Error::BadDelta);
    }
    let size = delta_size(delta, &mut pos)?;
    let mut out = Vec::with_capacity(size);
    while pos < delta.len() {
        let command = delta[pos];
        pos += 1;
        if command & 0x80 != 0 {
            let mut offset = 0usize;
            let mut length = 0usize;
            for bit in 0..4 {
                if command & (1 << bit) != 0 {
                    offset |= (*delta.get(pos).ok_or(Error::BadDelta)? as usize) << (8 * bit);
                    pos += 1;
                }
            }
            for bit in 0..3 {
                if command & (0x10 << bit) != 0 {
                    length |= (*delta.get(pos).ok_or(Error::BadDelta)? as usize) << (8 * bit);
                    pos += 1;
                }
            }
            if length == 0 {
                length = 0x10000;
            }
            let end = offset.checked_add(length).ok_or(Error::BadDelta)?;
            out.extend_from_slice(base.get(offset..end).ok_or(Error::BadDelta)?);
        } else if command != 0 {
            let end = pos + command as usize;
            out.extend_from_slice(delta.get(pos..end).ok_or(Error::BadDelta)?);
            pos = end;
        } else {
            return Err(Error::BadDelta);
        }
    }
    if out.len() != size {
        return Err(Error::BadDelta);
    }
    Ok(out)
}

/// Read every object in a packfile. Identifiers are computed, never read from an index.
pub fn read_pack(pack: &[u8]) -> Result<Vec<Object>, Error> {
    if pack.len() < 32 {
        return Err(Error::Truncated);
    }
    if &pack[0..4] != b"PACK" {
        return Err(Error::BadMagic);
    }
    let version = u32::from_be_bytes([pack[4], pack[5], pack[6], pack[7]]);
    if version != 2 && version != 3 {
        return Err(Error::BadVersion);
    }
    let count = u32::from_be_bytes([pack[8], pack[9], pack[10], pack[11]]) as usize;
    let body = pack.len() - 20;
    if sha1(&pack[..body])[..] != pack[body..] {
        return Err(Error::BadChecksum);
    }

    let mut entries: Vec<Entry> = Vec::with_capacity(count.min(1 << 20));
    let mut pos = 12;
    for _ in 0..count {
        let offset = pos;
        let mut b = byte(pack, &mut pos)?;
        let kind = (b >> 4) & 7;
        let mut size = (b & 15) as usize;
        let mut shift = 4u32;
        while b & 0x80 != 0 {
            b = byte(pack, &mut pos)?;
            if shift > 56 {
                return Err(Error::Truncated);
            }
            size |= ((b & 0x7f) as usize) << shift;
            shift += 7;
        }
        let base = match kind {
            1 => Base::None(Kind::Commit),
            2 => Base::None(Kind::Tree),
            3 => Base::None(Kind::Blob),
            4 => Base::None(Kind::Tag),
            6 => {
                let mut b = byte(pack, &mut pos)?;
                let mut back = (b & 0x7f) as usize;
                while b & 0x80 != 0 {
                    b = byte(pack, &mut pos)?;
                    back = back.checked_add(1).ok_or(Error::BadEntryType)?;
                    back = back.checked_mul(128).ok_or(Error::BadEntryType)? | (b & 0x7f) as usize;
                }
                Base::Offset(offset.checked_sub(back).ok_or(Error::MissingBase)?)
            }
            7 => {
                let end = pos + 20;
                let id: Id = pack.get(pos..end).ok_or(Error::Truncated)?.try_into().unwrap();
                pos = end;
                Base::Id(id)
            }
            _ => return Err(Error::BadEntryType),
        };
        if size > body {
            // A size larger than the whole pack cannot be honest for a delta; objects may still
            // legitimately expand, so only guard against absurd allocations.
            if size > 1 << 31 {
                return Err(Error::BadZlib);
            }
        }
        let (data, used) = inflate_exact(&pack[pos..body], size)?;
        pos += used;
        entries.push(Entry { offset, base, data });
    }

    let by_offset: HashMap<usize, usize> = entries.iter().enumerate().map(|(i, e)| (e.offset, i)).collect();
    let mut by_id: HashMap<Id, usize> = HashMap::with_capacity(entries.len());
    let mut resolved: Vec<Option<(Kind, Vec<u8>)>> = Vec::with_capacity(entries.len());
    let mut ids: Vec<Option<Id>> = vec![None; entries.len()];
    for (index, entry) in entries.iter_mut().enumerate() {
        if let Base::None(kind) = entry.base {
            let data = std::mem::take(&mut entry.data);
            let id = object_id(kind, &data);
            by_id.insert(id, index);
            ids[index] = Some(id);
            resolved.push(Some((kind, data)));
        } else {
            resolved.push(None);
        }
    }

    let mut pending = resolved.iter().filter(|r| r.is_none()).count();
    while pending > 0 {
        let mut progress = false;
        for index in 0..entries.len() {
            if resolved[index].is_some() {
                continue;
            }
            let base_index = match entries[index].base {
                Base::Offset(offset) => Some(*by_offset.get(&offset).ok_or(Error::MissingBase)?),
                Base::Id(id) => by_id.get(&id).copied(),
                Base::None(_) => unreachable!(),
            };
            let Some(base_index) = base_index else { continue };
            let Some((kind, base)) = &resolved[base_index] else { continue };
            let kind = *kind;
            let data = apply_delta(base, &entries[index].data)?;
            entries[index].data = Vec::new();
            let id = object_id(kind, &data);
            by_id.insert(id, index);
            ids[index] = Some(id);
            resolved[index] = Some((kind, data));
            pending -= 1;
            progress = true;
        }
        if !progress {
            return Err(Error::MissingBase);
        }
    }

    Ok(resolved
        .into_iter()
        .zip(ids)
        .map(|(object, id)| {
            let (kind, data) = object.unwrap();
            Object { id: id.unwrap(), kind, data }
        })
        .collect())
}
