# Browser proving remote chunk matrix

Use experiments/wasm-prover/scripts/remote-chunk-matrix.mjs to compare the current V2 circuit without mixing key identities or silently substituting an older manifest.

The runner covers 2, 4, 8, and 16 MiB signed manifests across CDN-hit and distinct fresh-prefix delivery, cold and warm browser cache, 8 and 16 workers, and idle and controlled-load host conditions. Cold/warm pairs reuse one persistent Chromium profile. The guarded benchmark records proof identity, contamination signals, applied worker telemetry, and observed Cloudflare cache headers.

The config is JSON with these required fields: harness_base_url, output_dir, browser_profile_dir, private_inputs_file, chunk_prefetch_windows, host_load_workers, and artifact_sets. A protected preview may also set browser_cookie_file to a local Netscape-format bypass cookie. Private inputs and cookie values are never served as assets or copied into matrix output — but the private inputs ARE injected into the harness page's JS scope, where any script served by the harness origin can read them. A loopback harness needs nothing extra; a remote harness requires https plus accept_remote_harness_private_input_exposure: true in the config, which asserts you control that deployment and the inputs are expendable benchmark keys (never real user secrets). artifact_sets must contain a hit entry plus distinct fresh entries keyed by worker/host/prefetch condition for 2, 4, 8, and 16 MiB.

Each public artifact object must provide the complete artifact block: key-manifest URL/signature/public key, VK, PK and index URLs, CCS URL/hash, chunk-manifest URL/signature/public key, deployment-manifest URL, and all three executable runtime URLs. The runner refuses partial sets. Every fresh cold/warm pair must use its own signed chunk-manifest URL and immutable transport prefix; changing an unsigned query string is not accepted as equivalent evidence.

Plan the matrix without launching proofs:

    node experiments/wasm-prover/scripts/remote-chunk-matrix.mjs --config /path/to/config.json --dry-run

Execute only after each signed set has been independently verified and uploaded:

    node experiments/wasm-prover/scripts/remote-chunk-matrix.mjs --config /path/to/config.json

The checked-in docs/benchmarks/v2-baseline-16m/ directory is a signature-verified historical V2 16 MiB baseline recovered from the local optimize-circuits-reconcile worktree. It pins the earlier runtime and must not be paired with newly built runtime bytes. Regenerate and sign a coherent candidate for optimization measurements.

## Coverage status (2026-07-14, run r1)

The v2-opt-r1 matrix (output/remote-browser-matrix-v2-opt-r1) measured the optimized runtime (W1-W3, W5-W7, pinned decode) against the Vercel preview harness:

- **Best measured results (the current reference baseline, superseding the signed-r8 G1 gate's 70,400 ms / 1.4593 GiB):** warm 16-worker **41.46 s** (`v2-2m-fresh-warm-w16-idle-pf4`), cold 16-worker **47.68 s** (`v2-2m-hit-cold-w16-idle-pf2`), peak heap **~0.83 GiB**, all proofs verified locally. Compare future optimization work against these, not the r8 gate.

- **2 MiB tier: complete** (all 32 cases, cold/warm x hit/fresh x 8/16 workers x idle/loaded, pf2 and pf4). 16 workers: 41.5-51.5 s; 8 workers: 63.4-81.0 s. All proofs verified locally.
- **4 MiB tier: partial** (CDN-hit cases only). Results track the 2 MiB tier within noise. The one anomalous result (v2-4m-hit-warm-w16-idle-pf4, 86.7 s) did not reproduce on re-measurement (55.9 s, verified; output/gogc50-comparison/results/rerun-v2-4m-hit-warm-w16-idle-pf4.summary.json); treat the original sample as contaminated.
- **16 MiB tier: explicitly descoped for this release.** Production ships the 2 MiB chunk tier (see the pk2m CCS/PK prefixes in reclaim-deployment.json), which is fully measured. The 16 MiB tier remains covered only by the historical baseline above; re-measure it before any future chunk-size change.
- **Go runtime tuning:** gogc=15/gomemlimit=3200MiB (shipped in the deployment descriptor) was measured 9-27% faster than gogc=50/3000MiB across cold/warm and 8/16-worker cases (output/gogc50-comparison). Do not raise gogc on the single-threaded main instance without re-measuring.
