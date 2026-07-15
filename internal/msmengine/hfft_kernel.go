package msmengine

// hfft_kernel.go is the build-tag-free whole-vector FFT worker kernel behind
// opt-W8 (computeH transforms on dedicated FFT workers). Like serialize.go's
// shard kernel, keeping it off the js && wasm tag means the exact bytes a
// worker receives — and the transformed vector it returns — are validated on
// native Go against gnark's serial FFT, not merely compiled.
//
// The kernel runs gnark-crypto's own FFT/FFTInverse with NbTasks(1) on a
// WithoutPrecompute domain, i.e. the identical code and schedule the main
// thread runs today inside computeH. Field arithmetic is exact, so the
// transformed vector is bit-identical to the serial path by construction;
// the only surface this kernel adds is the scalar (de)serialization, which
// reuses the audited worker wire format (fr.Element.Bytes(), 32-byte
// big-endian canonical).
//
// computeH's fixed schedule uses exactly two transform shapes:
//   - inverse, no coset:  domain.FFTInverse(v, fft.DIF)
//   - forward, on coset:  domain.FFT(v, fft.DIT, fft.OnCoset(), table)
//   - inverse, on coset:  domain.FFTInverse(v, fft.DIF, fft.OnCoset(), table)
// The decimation is implied by the direction, so the wire protocol carries
// only (inverse, coset, cardinality).

import (
	"fmt"
	"sync"

	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/fft"
)

// hTransformParams describes one whole-vector computeH transform.
type hTransformParams struct {
	Inverse     bool   `json:"inverse"`
	Coset       bool   `json:"coset"`
	Cardinality uint64 `json:"cardinality"`
}

func (p hTransformParams) validate(n int) error {
	if p.Cardinality == 0 || p.Cardinality&(p.Cardinality-1) != 0 {
		return fmt.Errorf("hfft: cardinality %d is not a power of two", p.Cardinality)
	}
	if uint64(n) != p.Cardinality {
		return fmt.Errorf("hfft: vector has %d elements, domain cardinality is %d", n, p.Cardinality)
	}
	return nil
}

// hTransformCosetTable is the worker's reusable coset exponent table,
// mirroring the vendored W6 discipline: one backing array per wasm instance,
// rebuilt in place only when the generator (direction) or size changes, so
// repeated transforms never re-allocate the domain-sized (64 MiB at 2^21)
// table. Guarded by a mutex for the native tests; each FFT worker instance
// runs one transform at a time.
var (
	hTableMu        sync.Mutex
	hTable          []fr.Element
	hTableGenerator fr.Element
)

func hCosetTable(generator fr.Element, size int) []fr.Element {
	if len(hTable) == size && hTableGenerator.Equal(&generator) {
		return hTable
	}
	if cap(hTable) < size {
		hTable = make([]fr.Element, size)
	} else {
		hTable = hTable[:size]
	}
	fft.BuildExpTable(generator, hTable)
	hTableGenerator = generator
	return hTable
}

// hTransformVector applies the transform in place. Exposed for the js worker
// wrapper and the native differential test; the caller owns vec.
func hTransformVector(vec []fr.Element, p hTransformParams) error {
	if err := p.validate(len(vec)); err != nil {
		return err
	}
	domain := fft.NewDomain(p.Cardinality, fft.WithoutPrecompute())
	opts := []fft.Option{fft.WithNbTasks(1)}
	if p.Coset {
		// Same caller-owned exponent-table contract as computeH's W6 path:
		// forward transforms take powers of FrMultiplicativeGen, inverse ones
		// powers of FrMultiplicativeGenInv. The W2 no-precompute domain has no
		// stored coset table for the DIT path, so the table is required here.
		hTableMu.Lock()
		defer hTableMu.Unlock()
		generator := domain.FrMultiplicativeGen
		if p.Inverse {
			generator = domain.FrMultiplicativeGenInv
		}
		opts = append(opts, fft.OnCoset(), fft.WithCosetTable(hCosetTable(generator, int(p.Cardinality))))
	}
	if p.Inverse {
		domain.FFTInverse(vec, fft.DIF, opts...)
	} else {
		domain.FFT(vec, fft.DIT, opts...)
	}
	return nil
}

// hTransformBytes is the wire-level kernel: canonical scalar bytes in,
// transformed canonical scalar bytes out.
func hTransformBytes(vecBuf []byte, p hTransformParams) ([]byte, error) {
	vec, err := unmarshalScalars(vecBuf)
	if err != nil {
		return nil, fmt.Errorf("hfft: %w", err)
	}
	if err := hTransformVector(vec, p); err != nil {
		return nil, err
	}
	return marshalScalars(vec), nil
}
