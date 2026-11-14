//! Loose objects, commits and trees.

use crate::{hex, Error, Id, Kind};

/// Split an envelope (`"<kind> <len>\0<content>"`) into its kind and content, checking the length.
pub fn open_envelope(envelope: &[u8]) -> Result<(Kind, &[u8]), Error> {
    let nul = envelope.iter().position(|b| *b == 0).ok_or(Error::BadObject)?;
    let header = &envelope[..nul];
    let space = header.iter().position(|b| *b == b' ').ok_or(Error::BadObject)?;
    let kind = Kind::from_name(&header[..space]).ok_or(Error::BadObject)?;
    let length: usize = std::str::from_utf8(&header[space + 1..])
        .ok()
        .and_then(|text| text.parse().ok())
        .ok_or(Error::BadObject)?;
    let content = &envelope[nul + 1..];
    if content.len() != length {
        return Err(Error::BadObject);
    }
    Ok((kind, content))
}

/// Inflate a loose object as git stores it on disk, and check that it is a well-formed envelope.
pub fn inflate_loose(compressed: &[u8]) -> Result<Vec<u8>, Error> {
    let envelope = miniz_oxide::inflate::decompress_to_vec_zlib(compressed).map_err(|_| Error::BadZlib)?;
    open_envelope(&envelope)?;
    Ok(envelope)
}

pub struct TreeEntry<'a> {
    pub mode: &'a [u8],
    pub name: &'a [u8],
    pub id: Id,
}

pub fn parse_tree(content: &[u8]) -> Result<Vec<TreeEntry<'_>>, Error> {
    let mut entries = Vec::new();
    let mut rest = content;
    while !rest.is_empty() {
        let space = rest.iter().position(|b| *b == b' ').ok_or(Error::BadObject)?;
        let nul = rest.iter().position(|b| *b == 0).ok_or(Error::BadObject)?;
        if nul < space || rest.len() < nul + 21 {
            return Err(Error::BadObject);
        }
        let id: Id = rest[nul + 1..nul + 21].try_into().unwrap();
        entries.push(TreeEntry { mode: &rest[..space], name: &rest[space + 1..nul], id });
        rest = &rest[nul + 21..];
    }
    Ok(entries)
}

pub struct Commit<'a> {
    pub tree: &'a [u8],
    pub parents: Vec<&'a [u8]>,
    pub author: &'a [u8],
    pub committer: &'a [u8],
    pub message: &'a [u8],
}

pub fn parse_commit(content: &[u8]) -> Result<Commit<'_>, Error> {
    let mut commit = Commit { tree: b"", parents: Vec::new(), author: b"", committer: b"", message: b"" };
    let mut rest = content;
    loop {
        let end = rest.iter().position(|b| *b == b'\n').ok_or(Error::BadObject)?;
        let line = &rest[..end];
        rest = &rest[end + 1..];
        if line.is_empty() {
            commit.message = rest;
            break;
        }
        if line[0] == b' ' {
            continue; // continuation of a multi-line header such as a signature
        }
        let space = line.iter().position(|b| *b == b' ').unwrap_or(line.len());
        let value = line.get(space + 1..).unwrap_or(b"");
        match &line[..space] {
            b"tree" => commit.tree = value,
            b"parent" => commit.parents.push(value),
            b"author" => commit.author = value,
            b"committer" => commit.committer = value,
            _ => {}
        }
    }
    if commit.tree.len() != 40 {
        return Err(Error::BadObject);
    }
    Ok(commit)
}

fn json_string(out: &mut String, bytes: &[u8]) {
    out.push('"');
    for ch in String::from_utf8_lossy(bytes).chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn tree_json(content: &[u8]) -> Result<String, Error> {
    let mut out = String::from("[");
    for (index, entry) in parse_tree(content)?.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"mode\":");
        json_string(&mut out, entry.mode);
        out.push_str(",\"name\":");
        json_string(&mut out, entry.name);
        out.push_str(",\"id\":\"");
        out.push_str(&hex(&entry.id));
        out.push_str("\"}");
    }
    out.push(']');
    Ok(out)
}

pub fn commit_json(content: &[u8]) -> Result<String, Error> {
    let commit = parse_commit(content)?;
    let mut out = String::from("{\"tree\":");
    json_string(&mut out, commit.tree);
    out.push_str(",\"parents\":[");
    for (index, parent) in commit.parents.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        json_string(&mut out, parent);
    }
    out.push_str("],\"author\":");
    json_string(&mut out, commit.author);
    out.push_str(",\"committer\":");
    json_string(&mut out, commit.committer);
    out.push_str(",\"message\":");
    json_string(&mut out, commit.message);
    out.push('}');
    Ok(out)
}
