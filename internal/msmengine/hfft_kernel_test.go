package msmengine

import (
	"crypto/rand"
	"testing"

	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/fft"
)

func randomFrVector(t *testing.T, n int) []fr.Element {
	t.Helper()
	vec := make([]fr.Element, n)
	var buf [32]byte
	for i := range vec {
		if _, err := rand.Read(buf[:]); err != nil {
			t.Fatal(err)
		}
		vec[i].SetBytes(buf[:])
	}
	return vec
}

// TestHTransformMatchesSerialFFT drives every transform shape computeH uses
// through the wire-level kernel and asserts the result is bit-identical to
// calling gnark's serial FFT directly — the invariant opt-W8 relies on.
func TestHTransformMatchesSerialFFT(t *testing.T) {
	for _, n := range []int{16, 256, 1024} {
		domain := fft.NewDomain(uint64(n), fft.WithoutPrecompute())
		fwdTable := make([]fr.Element, n)
		fft.BuildExpTable(domain.FrMultiplicativeGen, fwdTable)
		invTable := make([]fr.Element, n)
		fft.BuildExpTable(domain.FrMultiplicativeGenInv, invTable)

		shapes := []struct {
			name      string
			params    hTransformParams
			reference func(vec []fr.Element)
		}{
			{"ifft-dif", hTransformParams{Inverse: true, Cardinality: uint64(n)}, func(vec []fr.Element) {
				domain.FFTInverse(vec, fft.DIF, fft.WithNbTasks(1))
			}},
			{"fft-dit-coset", hTransformParams{Coset: true, Cardinality: uint64(n)}, func(vec []fr.Element) {
				domain.FFT(vec, fft.DIT, fft.OnCoset(), fft.WithCosetTable(fwdTable), fft.WithNbTasks(1))
			}},
			{"ifft-dif-coset", hTransformParams{Inverse: true, Coset: true, Cardinality: uint64(n)}, func(vec []fr.Element) {
				domain.FFTInverse(vec, fft.DIF, fft.OnCoset(), fft.WithCosetTable(invTable), fft.WithNbTasks(1))
			}},
		}
		for _, shape := range shapes {
			vec := randomFrVector(t, n)
			want := make([]fr.Element, n)
			copy(want, vec)
			shape.reference(want)

			got, err := hTransformBytes(marshalScalars(vec), shape.params)
			if err != nil {
				t.Fatalf("n=%d %s: %v", n, shape.name, err)
			}
			gotVec, err := unmarshalScalars(got)
			if err != nil {
				t.Fatalf("n=%d %s: unmarshal: %v", n, shape.name, err)
			}
			for i := range want {
				if !want[i].Equal(&gotVec[i]) {
					t.Fatalf("n=%d %s: element %d differs", n, shape.name, i)
				}
			}
		}
	}
}

// TestHTransformRejectsBadParams pins the fail-closed input checks.
func TestHTransformRejectsBadParams(t *testing.T) {
	vec := marshalScalars(randomFrVector(t, 16))
	if _, err := hTransformBytes(vec, hTransformParams{Cardinality: 15}); err == nil {
		t.Fatal("non-power-of-two cardinality accepted")
	}
	if _, err := hTransformBytes(vec, hTransformParams{Cardinality: 32}); err == nil {
		t.Fatal("cardinality/vector length mismatch accepted")
	}
	if _, err := hTransformBytes(vec[:33], hTransformParams{Cardinality: 16}); err == nil {
		t.Fatal("ragged scalar buffer accepted")
	}
}
