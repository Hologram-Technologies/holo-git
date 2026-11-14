//! The WebAssembly boundary. No imports; the host passes bytes in and takes bytes out.
//!
//! Every call returns a pointer to `[status: u32 LE][length: u32 LE][payload]`.
//! Status 0 is success. The host frees it with `eng_free(pointer, 8 + length)`.

use crate::object::{commit_json, inflate_loose, open_envelope, tree_json};
use crate::pack::read_pack;
use crate::{envelope_header, sha1, Error};

fn code(error: Error) -> u32 {
    match error {
        Error::Truncated => 1,
        Error::BadMagic => 2,
        Error::BadVersion => 3,
        Error::BadChecksum => 4,
        Error::BadEntryType => 5,
        Error::BadZlib => 6,
        Error::BadDelta => 7,
        Error::MissingBase => 8,
        Error::BadObject => 9,
    }
}

fn reply(result: Result<Vec<u8>, Error>) -> *mut u8 {
    let (status, payload) = match result {
        Ok(payload) => (0, payload),
        Err(error) => (code(error), Vec::new()),
    };
    let mut out = Vec::with_capacity(8 + payload.len());
    out.extend_from_slice(&status.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&payload);
    let mut boxed = out.into_boxed_slice();
    let pointer = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    pointer
}

unsafe fn input<'a>(pointer: *const u8, length: usize) -> &'a [u8] {
    if length == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(pointer, length)
    }
}

#[no_mangle]
pub extern "C" fn eng_alloc(length: usize) -> *mut u8 {
    let mut boxed = vec![0u8; length].into_boxed_slice();
    let pointer = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    pointer
}

/// # Safety
/// `pointer` and `length` must come from `eng_alloc` or from a reply of this module.
#[no_mangle]
pub unsafe extern "C" fn eng_free(pointer: *mut u8, length: usize) {
    if !pointer.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(pointer, length)));
    }
}

/// Packfile in; for each object `[id: 20][envelope length: u32 LE][envelope]` out.
///
/// # Safety
/// `pointer..pointer+length` must be readable.
#[no_mangle]
pub unsafe extern "C" fn eng_pack(pointer: *const u8, length: usize) -> *mut u8 {
    reply(read_pack(input(pointer, length)).map(|objects| {
        let total: usize = objects.iter().map(|o| 44 + o.data.len()).sum();
        let mut out = Vec::with_capacity(total);
        for object in objects {
            let header = envelope_header(object.kind, object.data.len());
            out.extend_from_slice(&object.id);
            out.extend_from_slice(&((header.len() + object.data.len()) as u32).to_le_bytes());
            out.extend_from_slice(&header);
            out.extend_from_slice(&object.data);
        }
        out
    }))
}

/// Zlib-compressed loose object in; `[id: 20][envelope]` out.
///
/// # Safety
/// `pointer..pointer+length` must be readable.
#[no_mangle]
pub unsafe extern "C" fn eng_loose(pointer: *const u8, length: usize) -> *mut u8 {
    reply(inflate_loose(input(pointer, length)).map(|envelope| {
        let mut out = Vec::with_capacity(20 + envelope.len());
        out.extend_from_slice(&sha1(&envelope));
        out.extend_from_slice(&envelope);
        out
    }))
}

/// Envelope in; its 20-byte identifier out. Fails if the envelope is malformed.
///
/// # Safety
/// `pointer..pointer+length` must be readable.
#[no_mangle]
pub unsafe extern "C" fn eng_label(pointer: *const u8, length: usize) -> *mut u8 {
    let envelope = input(pointer, length);
    reply(open_envelope(envelope).map(|_| sha1(envelope).to_vec()))
}

/// Commit envelope in; JSON out.
///
/// # Safety
/// `pointer..pointer+length` must be readable.
#[no_mangle]
pub unsafe extern "C" fn eng_commit(pointer: *const u8, length: usize) -> *mut u8 {
    reply(open_envelope(input(pointer, length)).and_then(|(_, content)| commit_json(content)).map(String::into_bytes))
}

/// Tree envelope in; JSON out.
///
/// # Safety
/// `pointer..pointer+length` must be readable.
#[no_mangle]
pub unsafe extern "C" fn eng_tree(pointer: *const u8, length: usize) -> *mut u8 {
    reply(open_envelope(input(pointer, length)).and_then(|(_, content)| tree_json(content)).map(String::into_bytes))
}
