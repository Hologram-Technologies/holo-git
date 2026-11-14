"""Turn a replica directory into a git repository, so git itself can check it.

usage: python scripts/replica-to-git.py <replica directory> <new git directory>

A replica stores each object as git's loose-object envelope, uncompressed, under
objects/sha1/<2 hex>/<38 hex>. Git stores the same bytes zlib-compressed. This script
compresses them into place and sets each branch from state.json. It trusts nothing:
run `git fsck --strict` on the result.
"""
import json
import os
import subprocess
import sys
import zlib

replica, target = sys.argv[1], sys.argv[2]
subprocess.run(['git', 'init', '-q', '-b', 'main', target], check=True)
count = 0
source = os.path.join(replica, 'objects', 'sha1')
for shard in sorted(os.listdir(source)):
    for name in sorted(os.listdir(os.path.join(source, shard))):
        with open(os.path.join(source, shard, name), 'rb') as handle:
            envelope = handle.read()
        out = os.path.join(target, '.git', 'objects', shard)
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, name), 'wb') as handle:
            handle.write(zlib.compress(envelope))
        count += 1
with open(os.path.join(replica, 'state.json'), encoding='utf-8') as handle:
    state = json.load(handle)
for ref, entry in state['refs'].items():
    subprocess.run(['git', '-C', target, 'update-ref', ref, entry['id']], check=True)
print(f'{count} objects, refs: ' + ', '.join(f"{ref} {entry['id'][:7]}" for ref, entry in state['refs'].items()))
