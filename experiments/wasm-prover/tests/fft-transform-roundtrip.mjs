// fft-transform-roundtrip.mjs — JS-boundary check for the opt-W8 FFT worker
// kernel (__msmengineFFTTransform). The byte-level kernel is pinned against
// gnark's serial FFT natively (TestHTransformMatchesSerialFFT); this harness
// exercises the same entrypoint through the real wasm/JS boundary and asserts
// the mathematical inverse pairs recover the input bit-exactly:
//   ifft(DIF) ∘ fft(DIT)             == identity
//   ifft_coset(DIF) ∘ fft_coset(DIT) == identity
//
// Run (from proof-tool):
//   GOOS=js GOARCH=wasm go build -mod=vendor \
//     -o experiments/wasm-prover/web/msmworker.wasm ./cmd/msmworker
//   GOROOT="$(go env GOROOT)" node experiments/wasm-prover/tests/fft-transform-roundtrip.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasm =
  process.env.MSMWORKER_WASM || path.resolve(__dirname, '../web/msmworker.wasm');
const wasmExec =
  process.env.WASM_EXEC_JS ||
  (process.env.GOROOT ? path.join(process.env.GOROOT, 'lib/wasm/wasm_exec.js') : '');
if (!wasmExec) throw new Error('set GOROOT or WASM_EXEC_JS');

const CARDINALITY = 1024;
const SC = 32;

async function loadKernel() {
  vm.runInThisContext(readFileSync(wasmExec, 'utf8'));
  const go = new globalThis.Go();
  const { instance } = await WebAssembly.instantiate(readFileSync(wasm), go.importObject);
  go.run(instance);
  while (!globalThis.__msmengineReady) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
  await loadKernel();
  assert.equal(typeof globalThis.__msmengineFFTTransform, 'function', 'FFT kernel registered');
  // Valid canonical scalars minted by the kernel itself.
  const { scs } = globalThis.__msmengineTestRandomG1(CARDINALITY);
  const original = new Uint8Array(scs);
  assert.equal(original.byteLength, CARDINALITY * SC);

  for (const coset of [false, true]) {
    let vec = new Uint8Array(original);
    vec = globalThis.__msmengineFFTTransform(vec, true, coset, CARDINALITY); // inverse
    assert.equal(vec.byteLength, original.byteLength);
    assert.notDeepEqual(new Uint8Array(vec), original, `inverse coset=${coset} changed the vector`);
    vec = globalThis.__msmengineFFTTransform(vec, false, coset, CARDINALITY); // forward undoes it
    assert.deepEqual(new Uint8Array(vec), original, `roundtrip coset=${coset} is the identity`);
  }

  // Parameter validation is pinned natively (TestHTransformRejectsBadParams);
  // the kernel panics on malformed params like the shard kernels, which kills
  // the worker instance — not catchable as a JS exception here.
  console.log(`PASS: fft-transform roundtrips (n=${CARDINALITY}, plain + coset) through the wasm boundary`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
