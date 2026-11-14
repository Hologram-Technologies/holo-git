//! Line diff (Myers, minimal) and blame.

use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Equal = 0,
    Delete = 1,
    Insert = 2,
}

/// A run of consecutive lines with the same fate.
pub type Run = (Op, u32);

/// Beyond this many differing lines the diff stops searching and reports a full replacement
/// of the differing middle. The result is still correct, only not minimal.
const MAX_DISTANCE: usize = 2000;

/// Lines keep their terminator, so a final line without a newline differs from one with it.
pub fn lines(bytes: &[u8]) -> Vec<&[u8]> {
    bytes.split_inclusive(|b| *b == b'\n').collect()
}

fn push(runs: &mut Vec<Run>, op: Op, count: u32) {
    if count == 0 {
        return;
    }
    match runs.last_mut() {
        Some((last, total)) if *last == op => *total += count,
        _ => runs.push((op, count)),
    }
}

/// Shortest edit script between two sequences, as steps from the end backwards.
fn myers(a: &[u32], b: &[u32]) -> Option<Vec<Op>> {
    let n = a.len() as i64;
    let m = b.len() as i64;
    let max = ((n + m) as usize).min(MAX_DISTANCE) as i64;
    let offset = max + 1;
    let mut v = vec![0i64; (2 * max + 3) as usize];
    let mut trace: Vec<Vec<i64>> = Vec::new();
    let at = |v: &[i64], k: i64| v[(k + offset) as usize];

    let mut found = None;
    'search: for d in 0..=max {
        trace.push(v[(offset - d) as usize..=(offset + d) as usize].to_vec());
        let mut k = -d;
        while k <= d {
            let mut x = if k == -d || (k != d && at(&v, k - 1) < at(&v, k + 1)) { at(&v, k + 1) } else { at(&v, k - 1) + 1 };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[(k + offset) as usize] = x;
            if x >= n && y >= m {
                found = Some(d);
                break 'search;
            }
            k += 2;
        }
    }
    let distance = found?;

    let mut ops = Vec::new();
    let (mut x, mut y) = (n, m);
    for d in (0..=distance).rev() {
        let saved = &trace[d as usize];
        let get = |k: i64| saved[(k + d) as usize];
        let k = x - y;
        let previous_k = if k == -d || (k != d && get(k - 1) < get(k + 1)) { k + 1 } else { k - 1 };
        let previous_x = if d == 0 { 0 } else { get(previous_k) };
        let previous_y = if d == 0 { 0 } else { previous_x - previous_k };
        while x > previous_x && y > previous_y {
            ops.push(Op::Equal);
            x -= 1;
            y -= 1;
        }
        if d > 0 {
            ops.push(if x == previous_x { Op::Insert } else { Op::Delete });
        }
        x = previous_x;
        y = previous_y;
    }
    Some(ops)
}

/// The edit script that turns `old` into `new`, as runs of lines.
pub fn diff(old: &[u8], new: &[u8]) -> Vec<Run> {
    let old_lines = lines(old);
    let new_lines = lines(new);
    let mut names: HashMap<&[u8], u32> = HashMap::new();
    let mut intern = |line| {
        let next = names.len() as u32;
        *names.entry(line).or_insert(next)
    };
    let a: Vec<u32> = old_lines.iter().map(|l| intern(*l)).collect();
    let b: Vec<u32> = new_lines.iter().map(|l| intern(*l)).collect();

    let mut head = 0;
    while head < a.len() && head < b.len() && a[head] == b[head] {
        head += 1;
    }
    let mut tail = 0;
    while tail < a.len() - head && tail < b.len() - head && a[a.len() - 1 - tail] == b[b.len() - 1 - tail] {
        tail += 1;
    }
    let middle_a = &a[head..a.len() - tail];
    let middle_b = &b[head..b.len() - tail];

    let mut runs = Vec::new();
    push(&mut runs, Op::Equal, head as u32);
    match myers(middle_a, middle_b) {
        Some(ops) => {
            for op in ops.into_iter().rev() {
                push(&mut runs, op, 1);
            }
        }
        None => {
            push(&mut runs, Op::Delete, middle_a.len() as u32);
            push(&mut runs, Op::Insert, middle_b.len() as u32);
        }
    }
    push(&mut runs, Op::Equal, tail as u32);
    runs
}

/// For each line of `versions[0]`, the index of the oldest version that already had it.
///
/// `versions` runs from newest to oldest, each the direct ancestor of the one before.
/// A line is followed back for as long as the diff reports it unchanged.
pub fn blame(versions: &[&[u8]]) -> Vec<u32> {
    let Some(newest) = versions.first() else { return Vec::new() };
    let count = lines(newest).len();
    let mut owner = vec![0u32; count];
    // position[i]: where line i of the newest version sits in the version being examined.
    let mut position: Vec<Option<u32>> = (0..count as u32).map(Some).collect();
    for step in 1..versions.len() {
        if position.iter().all(Option::is_none) {
            break;
        }
        // moved[j]: the line of the older version that line j of the younger one came from.
        let mut moved: Vec<Option<u32>> = Vec::new();
        let mut older_line = 0u32;
        for (op, run) in diff(versions[step], versions[step - 1]) {
            match op {
                Op::Equal => {
                    for _ in 0..run {
                        moved.push(Some(older_line));
                        older_line += 1;
                    }
                }
                Op::Delete => older_line += run,
                Op::Insert => moved.extend(std::iter::repeat(None).take(run as usize)),
            }
        }
        for line in 0..count {
            if let Some(current) = position[line] {
                position[line] = moved[current as usize];
                if position[line].is_some() {
                    owner[line] = step as u32;
                }
            }
        }
    }
    owner
}
