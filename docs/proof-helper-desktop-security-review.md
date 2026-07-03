# Proof Helper Desktop Security Review

This review covers the first Tauri-based Proof Helper implementation surface in
this repository. It is a local implementation handoff, not a sign-off for a
public release.

## Scope

- Hosted ownership-proof website.
- Pairing fragment from Proof Helper to website.
- Tauri desktop shell under `apps/proof-helper-desktop`.
- Go `proof-tool serve-helper` sidecar.
- Local proving-key cache.
- Hosted verifier API and backend-bound proof artifact.
- Draft release automation in `.github/workflows/release-proof-helper.yml`.

## Implemented Controls

- `serve-helper` still binds only to loopback and rejects non-loopback listen
  addresses.
- Focused command tests cover missing `--site-url`, rejection of `0.0.0.0`
  helper binds, startup JSON pairing data in the URL fragment, and matching
  allowed origins.
- Helper proof and shutdown requests still require exact allowed origins and
  `X-Proof-Tool-Token`.
- Token comparison remains constant-time.
- Helper CORS now answers Chrome Private Network Access preflights for allowed
  origins with `Access-Control-Allow-Private-Network: true`.
- Production helper proving now loads an existing key bundle with
  `LoadOwnershipProver`; it does not silently create Groth16 keys unless
  `--dev-create-keys` is explicitly set.
- Key manifests now carry key version, file digest, file size, tool version,
  gnark version, and signature-key metadata fields.
- Key verification streams file digests instead of reading large proving keys
  into memory.
- `/status` now reports sidecar version, protocol version, circuit id, key
  version, key hash, key readiness, compatibility, and supported origins.
- Sidecar startup emits one machine-readable JSON line on stdout for Tauri.
- Backend-bound proof artifacts still strip derivation path metadata by default.
- The website now treats helper compatibility states as distinct: offline,
  ready, key missing, key downloading, and update required.
- The Tauri shell computes app-data key-cache paths, can delete the active and
  temporary cache directories, and starts the sidecar with `--no-open` so the
  app controls when the pairing URL is opened.
- Tauri sidecar launch arguments, target-triple binary candidates, and startup
  JSON validation are now centralized in `sidecar-core`; the app validates that
  startup pairing data uses a loopback helper URL and puts `helper`/`pair` in
  the fragment rather than the query before accepting the sidecar as started.
- Key-bundle activation now verifies an Ed25519 manifest signature, expected
  signature key id, circuit/key metadata, proving-key SHA-256 and BLAKE2b-256,
  verifying-key SHA-256 and BLAKE2b-256, file sizes, and available disk space
  before atomically replacing the active cache directory.
- Key-bundle staging can now report per-file copied/total bytes and can abort
  before activation; cancellation removes `downloading.tmp` while preserving the
  previously active cache.
- The Tauri command layer exposes activation progress through app events and a
  separate cancel command; the desktop UI disables cache deletion during
  activation and routes cancellation before the active cache is replaced.
- Tauri command signatures are runtime-generic so the same invoke handler can be
  exercised under Tauri's mock runtime and the production Wry runtime.

## Secret-Handling Review

- The hosted verifier receives only proof artifacts and public target fields.
- The website still derives the master XPrv in the browser worker and sends it
  only to the paired loopback helper.
- The helper accepts master XPrv in the local request body, not on the process
  command line.
- New status, startup, and release-note fields do not include seed phrases,
  entropy, master XPrv, private witness values, or derivation paths.
- The startup JSON includes the per-session pairing token because the desktop
  app needs it to open the fragment URL. Treat stdout from production sidecar
  supervision as local-sensitive process output.

## Compatibility Notes

- Chrome Private Network Access preflight behavior is covered by Go unit tests
  for allowed origins.
- Browser-specific loopback behavior across Chrome, Edge, Firefox, and Safari
  still needs manual target-browser testing.
- Linux Tauri native checks now pass in WSL after installing the GTK/WebKit
  development prerequisites. The earlier blocker was the expected native Tauri
  stack, not an application code issue.
- `pnpm check:tauri-prereqs` in `apps/proof-helper-desktop` now checks the
  Linux pkg-config modules and headers required before rerunning native Tauri
  checks.
- A short WSLg launch check kept the debug Tauri app alive until timeout; Mesa
  EGL warnings were logged in this environment, but the app did not crash.

## Release Gates

Do not publish a ready release until these are complete:

- Apple Developer ID signing and notarization are configured and verified.
- Windows Authenticode signing is configured and verified.
- Tauri updater signing keys and updater metadata are configured and verified.
- The proving-key bundle is generated in controlled release infrastructure.
- `manifest.json`, `manifest.sig`, checksums, and checksum signatures are
  published together.
- Fresh install, corrupt download, wrong signature, wrong digest, delete-cache,
  update, and rollback behavior are tested on target OSes.
- Website release links point to actual installer assets or stable redirects.

## Accepted For Local MVP

- The first desktop shell keeps seed phrase entry in the hosted website. This
  keeps the current local-helper architecture intact but still trusts the
  JavaScript served for that session.
- The desktop shell supports an explicit dev sidecar path and fixture mode for
  local validation. Production packaging should use bundled sidecars.
- Linux `.rpm`, Windows ARM64, production auto-update enablement, and moving
  seed entry into Tauri remain follow-up decisions.

## Local Evidence

- `go test ./...` passed after helper hardening.
- `go test ./cmd/proof-tool` passed after adding startup pairing and loopback
  bind regression coverage.
- `pnpm test && pnpm typecheck && pnpm build` passed in
  `apps/ownership-proof-web`.
- `pnpm test && pnpm typecheck && pnpm build` passed in
  `apps/proof-helper-desktop`; the frontend test set now covers local source
  activation, progress display, and cancel action routing.
- `cargo test --manifest-path apps/proof-helper-desktop/src-tauri/key-bundle-core/Cargo.toml`
  passed 8 tests after adding progress/cancellation-aware staging.
- `cargo test --manifest-path apps/proof-helper-desktop/src-tauri/sidecar-core/Cargo.toml`
  passed.
- `cargo fmt` passed in `apps/proof-helper-desktop/src-tauri`.
- `pnpm check:tauri-prereqs` passed after installing the WSL native Tauri
  prerequisites.
- `cargo check` passed in `apps/proof-helper-desktop/src-tauri`.
- `PROOF_HELPER_SIDECAR_PATH=/home/gumbo/playground/proof-zk-recovery/proof-tool/apps/proof-helper-desktop/src-tauri/binaries/proof-tool-x86_64-unknown-linux-gnu cargo test`
  passed in `apps/proof-helper-desktop/src-tauri`; the Tauri IPC smoke started
  and stopped the real Go sidecar and checked the fragment pairing URL.
- `pnpm tauri build --debug --no-bundle` passed and produced the local debug
  desktop binary.
- Playwright drove the local website against fixture helper/verifier processes:
  auto-pairing, `/status`, `/prove`, `/api/verify`, verified UI state, and
  `/shutdown` all succeeded. The verifier request body did not contain a
  derivation `path`.
- `PROOF_TOOL_RUN_FULL_PROOF=1 go test ./internal/prover -run TestOwnershipProofRoundTripIntegration -count=1`
  passed in 214.696s, covering the real Groth16 proof round trip separately
  from the browser fixture flow.
