package verifier

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"

	"github.com/consensys/gnark/backend/groth16"
	"golang.org/x/crypto/blake2b"

	"proof-tool/internal/circuit/ownership"
	"proof-tool/internal/prover"
)

const PinnedVKHash = "blake2b256:e896ad2b9bceac9abe80de7a4ec91a9e41a55582b9b58fe3797bc203662b7c03"

const pinnedVKBase64 = "kk7FVXMXKT3G30nkCkRfXBXAKZgPBWd8UlhMPkpTa5jGLLSpLUEqArNJaltIPEcJlKbtJWDuCEMmGkudKbto/DMsfl0r+oKepUMXTGIa0rtMjfYzjuhOBDNQpH/KVxyPgSnCz53JXHMZjJ0jTL0tb+tmNv7Pql9eOaOia/KiI496mvCPPHf+jJV9RCxO6mrNEEN5Su5JG+uOqEyRmZBAkGKy41/Bm48Ka65kOAgy60vV5bBmjUGFjjT/ztIT/UDvtXkTPLyxT2l8w7HcLdoPnns/LU041r+dUYSBFGUtShVxZx7UiVw6+W47TCaIicL+F/SYVqpJKsuNscs1g5vsJ8obGthqBIoz1amhQmRZzhNLLoUeWqLip6yBg3Be4XrEuQzST8eJw9dN2EfoFgoGfJ0zZ/Lgo3NoANA3M3R3ruxiTMPiBbd9r5BzR7iiR7kGopKrqbhXL6WO5q9VHexjAWhD76gOizzfreQcTQsNC6vikr6bLaD6sINbsYlRwg8LArgJ4/XkZoI6lAmNi0dgmnFQFnEju3R/Lt8OaVR5qAwaIGdsl+3B69EwxZmVWQAeAAAAA6F10LvaBeC9cjOJH0EKL8E+G87fqgVcp8168H5n2fG6z8ihQieNunFGOxOzb3HaZo3Eq4RYvWmZo2Ox1cgvwEltndJyZPIMj2sHR77ARr1Ia8jHa33a1lWmdSCGuhIXkI1GdkBgti/dccXNfTXNEK4jN9Lab4zEhBPzK78meR7oWZVAYyEWLllQW4Pp90GUpQAAAAEAAAAAAAAAAaAn1xCcd6Ru1BvPz/ZtbFKejKtMrzgKMYzynXPhHupVH7vmGhJ9yFPgm80BX/Ph0g1oDVIHV1YRSwkKVi2MTpIVlOOzpUCT8WAESDDhZySo/TLVfGluGPwWlvm/iZ9QbrfhTlXSTBlV4aVnMayGpBHwn9Zcoj3JhsTgZ9KMeRNgBmLgfHk5JczMJ8CMc9qfZBO0elXe37V3ZbNiyEYnEYJEZZyNzK5fY91GT9vT9Xmhqat4pXKZggg4/580e6OuLA=="

type PinnedVerifier struct {
	vk groth16.VerifyingKey
}

func LoadPinnedVerifier() (*PinnedVerifier, error) {
	raw, err := base64.StdEncoding.DecodeString(pinnedVKBase64)
	if err != nil {
		return nil, fmt.Errorf("decode pinned verifying key: %w", err)
	}
	hash := vkHash(raw)
	if hash != PinnedVKHash {
		return nil, fmt.Errorf("pinned verifying key hash %s, want %s", hash, PinnedVKHash)
	}
	vk, err := prover.ReadVK(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("read pinned verifying key: %w", err)
	}
	return &PinnedVerifier{vk: vk}, nil
}

func (v *PinnedVerifier) VKHash() string {
	return PinnedVKHash
}

func (v *PinnedVerifier) VerifyProof(_ context.Context, proof groth16.Proof, publicInput *big.Int) error {
	return prover.VerifyProof(v.vk, proof, &ownership.Circuit{Pub: publicInput})
}

func vkHash(raw []byte) string {
	h := blake2b.Sum256(raw)
	return "blake2b256:" + hex.EncodeToString(h[:])
}
