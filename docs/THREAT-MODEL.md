# Threat model

Proposed for approval. First pass; to be revisited at every phase.

## What we protect

The integrity of code and history. Who may change what. The confidentiality of private repositories. Signing keys. The honesty of check results.

## Who we assume is hostile

Every replica. Any contributor. Any executor. Any network. Content inside repositories, issues and comments.
We assume the user's browser and device are honest, and that the hash functions and signature schemes hold.

## Threats

| Threat | Defence | What remains |
|---|---|---|
| Replica alters bytes | every read re-derives the label; kernel `restoreDecision` | none for integrity |
| Replica withholds data or serves an old head | signed, chained heads; several replicas; clients compare heads | a single-replica user can be kept stale without knowing |
| Replica shows different histories to different people | signed heads exchanged between clients expose the fork | detection, not prevention |
| Replica reorders issue numbers | numbers follow the signed chain; reordering breaks the chain | the replica chooses order among concurrent arrivals |
| Forged or unauthorized operation | signature check, then kernel `authorize`; uncounted if it fails | none if the kernel is asked every time |
| Host forgets to ask the kernel | one choke point in the service worker; tests that count decisions | this is the main unproved risk |
| Protected branch moved by force | every reader ignores an invalid ref update | terminal git users see the raw ref on a peer unless the peer also enforces |
| Stolen session key | non-extractable, scoped, short-lived; revocation operation | valid until expiry or revocation is seen |
| Lost passkey | several passkeys per person; recovery set chosen in advance | no recovery if none was set up |
| Malicious page delivery: the static host serves altered code | service worker pins the shell by digest; holo carries proof and provenance; reproducible build | the first visit trusts the host; a published digest and a second channel reduce this |
| Script injection through markdown or repository content | rendered in an opaque-origin sandbox; strict content policy | sandbox escape bugs in browsers |
| Executor returns a false result | trust policy: named anchors, or matching results from several independent executors | collusion among the executors a policy trusts |
| Reused result for different inputs | action key derived by the kernel from all declared inputs | an undeclared input makes a step wrongly reusable; the sandbox must deny undeclared access |
| Agent passes checks by editing them | check definitions and policy read from the base; edits need a person | a person approving carelessly |
| Instructions hidden in content aimed at agents | every item labelled with author anchor and trust level | the agent must honour the label |
| Secrets exposed to executors | released only to named anchors by delegation | a trusted executor can still leak |
| Private content read by a replica | client-side encryption | sizes, timing and access patterns leak |
| Removed reader keeps access | key rotation for new content | old content they fetched stays readable |
| SHA-1 collision in an imported repository | collision-detecting SHA-1; SHA-256 format by default | legacy repositories keep legacy risk |
| Storage exhaustion or eviction by the browser | request persistent storage; treat local store as a cache of replicas | unsynced work can be lost if the browser evicts |
| Flooding a repository with junk operations | unauthorized operations are not counted; replicas may rate-limit | storage cost on replicas |

## Out of scope

A compromised device or browser. Coercion of a key holder. Availability against a party who controls every replica a user knows.

## Open questions

How a new visitor first learns a trustworthy digest for the page.
Whether terminal git users are protected by peers enforcing ref rules, which needs upstream work.
Which executors a default trust policy names.
