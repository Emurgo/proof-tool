# Releasing `mpc-ceremony`

`mpc-ceremony` is an independently released ceremony engine. Its release gate
must not check out, pin, or depend on a Relay source commit. This keeps the
ceremony parser, cryptographic implementation, and release decision owned by
proof-tool.

The repository's `MPC ceremony release validation` workflow checks the
following proof-tool properties:

- the approved Go toolchain and module identity;
- the patched vendor tree;
- two byte-for-byte reproducible unsigned rehearsal packages containing the
  canonical Linux/amd64 binary and its Linux/arm64 counterpart;
- the downloadable tiny rehearsal initializer and authenticated definition
  projection; and
- absence of production signatures from rehearsal packages.

Production release maintainers additionally follow
`scripts/build-mpc-ceremony-release.sh` and
`scripts/verify-mpc-ceremony-reproducible.sh` using the approved signed tag and
offline build-signing key. Publish both `mpc-ceremony` (Linux/amd64) and
`mpc-ceremony-linux-arm64`, together with their complete verification package,
through proof-tool's release process.

New ceremony definitions use schema v2. The coordinator runs either released
binary and passes the other with repeated `--allowed-binary FILE` flags during
`init` (or `rehearsal init`). Initialization reads the embedded Go build
metadata and rejects different source commits, dependency versions, Go
versions, compiler/build policies, dirty states, or multiple binaries for one
platform. The signed definition records the full exact-digest allowlist;
legacy v1 definitions remain one-binary ceremonies.

## Coordinated distribution

Compatibility with Relay is tested after both projects have released
independently. The ceremony-kit process receives the exact approved Relay and
`mpc-ceremony` repositories, tags, binaries, and SHA-256 hashes. It runs the
binary-only tiny-rehearsal compatibility gate, including a real phase 1
contribution, erasure attestation, coordinator acceptance, and accepted-chain
inspection, and records the tested hashes in the kit's `compatibility.json`.

That downstream gate may reject a proposed pairing without invalidating either
independent release. Updating Relay never requires changing proof-tool's CI,
and releasing proof-tool never requires selecting a Relay commit.
