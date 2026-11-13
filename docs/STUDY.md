# Study notes

Read on 2026-11-13. Nothing from any cloned repository was built or run.
Where this file disagrees with `prompt.md`, this file is right: it comes from source, the prompt came from READMEs.

## Sources

| Source | Revision | How it was read |
|---|---|---|
| go-gitea/gitea | `eaa4fe91` | models, permissions, pull service read in full; routes and frontend by listing |
| UOR-Foundation/kappa-registry | `bd231d0c` (main) | source, with line references; `feat/rewrite-after-poc` is newer and unread |
| prism-code | 0.8.0 (npm) | `--help` for every verb |
| UOR-Foundation/foundry, template, LexLean, PrismPM | `5fa2a21`, `0bc0721`, `71defb4`, `7b48b4d` | specs, manifests, model sources, shell |
| Prism docs | 414,401 characters | key pages in full, rest by search |

## The five unknowns, resolved

1. Kappa label format. `<axis>:<lowercase-hex>` over raw bytes, no framing. Axes: `sha1`, `sha256`, `blake3`, `sha3-256`, `keccak256`, `sha512`. Length 45 to 135. A kappa peer also stores every blob under `sha256`.
2. UOR address derivation. Prism and Foundry use `blake3:` plus 64 hex of the raw bytes. The model spells the canonical preimage; the host computes the hash. The framework page says SHA-256 instead; practice is BLAKE3. No UOR-specific derivation exists in kappa-registry.
3. kappa-core on wasm32. It will not compile as it stands (static reading, high confidence): `rekindle-aead` pulls C and assembly, `zstd`/`xz2`/`bzip2` are C crates, the random source has no browser backend. No JavaScript or WASM client exists.
4. What Prism ships. The installed CLI (0.8.0) is far ahead of the docs. `init`, `build`, `verify`, `axioms`, `export`, `check`, `dev`, `push`, `pull` exist. `@prism-code/verify`, the Rust crate, `instantiate()` and streaming do not.
5. What a model can express. Language 1.2 has integers, bytes, strings, options, results, lists, records, enums, recursive types, `map` and `set`. No ambient state, no I/O, no time, no randomness. Maps are sorted lists with linear lookup. The proof language is a closed set of steps.

## Facts that change the design

Prism.
- The guest is a pure function from bytes to bytes with no imports. A fresh instance serves each request. Nothing persists inside it.
- Foundry caps request, response and allocation at 1 MiB. Its proved kernel is 70 KB of WASM from about 1 MB of LexLean, 247 theorems, 319 vectors, and takes about 20 minutes to prove.
- Capabilities in `prism.toml` are declarations only. The guest cannot use a key-value store or the network. PrismPM fixes the capability set to empty.
- The stateful browser application profile is closed (`PP2011`). An app ships as a pure guest plus a view bundle.
- The one-sentence `prism_build` path does not serve a hand-written model. The `template` repository's `app/` does.
- Build needs the SDK image under Docker or WSL, or `build --remote github`. The toolchain is pre-release: eight minor versions in three weeks.
- Foundry stores objects in IndexedDB and the shell in the Cache API. No use of OPFS was found.
- LexLean's standard library has SHA-256 but not BLAKE3.

kappa-registry.
- A page on another origin can only read. The router rejects every cross-origin request that is not GET, HEAD or OPTIONS. Blob upload, tag writes, edge writes, reconcile and git push are all blocked.
- Edges are not signed. The server fills in the asserter from a bearer token.
- Stored epoch roots are unsigned. The tag proof route returns no Merkle path.
- Passkeys do not authenticate storage or git requests. By default every caller is anonymous.
- Reading the authorization code suggests any caller may write to any non-reserved namespace. Medium confidence, not tested. Worth raising upstream.
- Git maps well: each object is a loose object at `sha1:<oid>` or `sha256:<oid>`, refs are tags with version compare-and-swap, fetch and push both exist, with `blob:none`.
- Reconcile over HTTP is a range fingerprint over tag names, not the set reconciliation the README describes.
- Content-defined chunking does not exist. Encryption is server-side and never switched on.
- The README is wrong in several places (identity routes, batch body, `If-Match` semantics).

Gitea.
- There is no reusable interface: 590 server-rendered templates with 26 Vue islands. The interface is rewritten; the templates are the specification.
- Every permission check runs on the server. Branch protection on push lives in a server-side hook.
- Issue and pull request numbers come from one atomic counter per repository.
- Merging shells out to the git command line under a global lock. Mergeability is computed by a background queue.
- Roughly 830 web routes, 500 API handlers, 24 package registry types, 15 background queues.

## Consequences

"Formally verified" can honestly cover decisions only: who may do what, whether a ref may move, whether a change may merge, how concurrent edits resolve. Storage, hashing, git parsing, networking and the interface are ordinary tested code.
The trust layer is ours to build. Signatures, signed ref history and verification live in the client; a kappa peer is plain addressed storage.
Writing from a browser to a replica is not possible against a stock kappa peer on another origin. See `ARCHITECTURE.md` for the options.
The addressing rule is settled and simple, which is the part the whole design leans on.

## Not verified

Whether kappa-core compiles for wasm32 was judged from manifests, not a build.
The namespace authorization gap is a reading, not a test.
The Foundry studio's `core.wasm` size and the SDK image size were not found.
`holospaces_web`'s hashing source and the `uor-addr` and `uor-jcs-nfc` repositories were not read.
Gitea's wiki, LFS, mirror and indexer internals were read by listing only.
