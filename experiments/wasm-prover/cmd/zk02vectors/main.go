package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/blake2b"

	"proof-tool/internal/batchtranscript"
)

type goldenVectors struct {
	Domain string       `json:"domain"`
	Cases  []goldenCase `json:"cases"`
}

type goldenCase struct {
	Name               string      `json:"name"`
	VKFile             string      `json:"vk_file"`
	ProofSource        proofSource `json:"proof_source"`
	PublicInputDigests []string    `json:"public_input_digests"`
	VKHash             string      `json:"vk_hash"`
	TranscriptHash     string      `json:"transcript_blake2b256"`
	R                  string      `json:"r"`
	S                  string      `json:"s"`
}

type proofSource struct {
	File   string `json:"file"`
	Rows   []int  `json:"rows,omitempty"`
	Repeat int    `json:"repeat,omitempty"`
}

func main() {
	vectorsPath := flag.String("vectors", "contracts/ownership-verifier/testdata/zk-02-batch-transcript-v2.json", "golden vector JSON to refresh")
	flag.Parse()

	encoded, err := os.ReadFile(*vectorsPath)
	if err != nil {
		fatalf("read vectors: %v", err)
	}
	var vectors goldenVectors
	if err := json.Unmarshal(encoded, &vectors); err != nil {
		fatalf("decode vectors: %v", err)
	}
	if vectors.Domain != batchtranscript.DomainV2 {
		fatalf("domain %q, want %q", vectors.Domain, batchtranscript.DomainV2)
	}

	fixtureDir := filepath.Dir(*vectorsPath)
	for index := range vectors.Cases {
		vector := &vectors.Cases[index]
		vk := readHex(filepath.Join(fixtureDir, vector.VKFile))
		proofs := loadProofs(fixtureDir, vector.ProofSource)
		digests := decodeAll(vector.PublicInputDigests)
		vkHash := batchtranscript.VKHash(vk)
		transcript, err := batchtranscript.BuildV2(vkHash[:], proofs, digests)
		if err != nil {
			fatalf("%s: build transcript: %v", vector.Name, err)
		}
		transcriptHash := blake2b.Sum256(transcript)
		vector.VKHash = hex.EncodeToString(vkHash[:])
		vector.TranscriptHash = hex.EncodeToString(transcriptHash[:])
		vector.R = batchtranscript.ChallengeV2(transcript).String()
		vector.S = batchtranscript.MergeChallengeV2(transcript).String()
		fmt.Printf("refreshed %s vk_hash=%s transcript=%s\n", vector.Name, vector.VKHash, vector.TranscriptHash)
	}

	updated, err := json.MarshalIndent(vectors, "", "  ")
	if err != nil {
		fatalf("encode vectors: %v", err)
	}
	updated = append(updated, '\n')
	if err := os.WriteFile(*vectorsPath, updated, 0o600); err != nil {
		fatalf("write vectors: %v", err)
	}
}

func loadProofs(fixtureDir string, source proofSource) [][]byte {
	encoded, err := os.ReadFile(filepath.Join(fixtureDir, source.File))
	if err != nil {
		fatalf("read proofs: %v", err)
	}
	if len(source.Rows) > 0 {
		fields := strings.Fields(string(encoded))
		proofs := make([][]byte, 0, len(source.Rows))
		for _, row := range source.Rows {
			position := row * 3
			if position+2 >= len(fields) {
				fatalf("fixture row %d missing from %s", row, source.File)
			}
			proofs = append(proofs, decodeHex(fields[position+2]))
		}
		return proofs
	}
	proof := decodeHex(string(encoded))
	repeat := source.Repeat
	if repeat == 0 {
		repeat = 1
	}
	proofs := make([][]byte, repeat)
	for index := range proofs {
		proofs[index] = append([]byte(nil), proof...)
	}
	return proofs
}

func readHex(path string) []byte {
	encoded, err := os.ReadFile(path)
	if err != nil {
		fatalf("read %s: %v", path, err)
	}
	return decodeHex(string(encoded))
}

func decodeAll(values []string) [][]byte {
	decoded := make([][]byte, len(values))
	for index, value := range values {
		decoded[index] = decodeHex(value)
	}
	return decoded
}

func decodeHex(value string) []byte {
	decoded, err := hex.DecodeString(strings.Join(strings.Fields(value), ""))
	if err != nil {
		fatalf("decode hex: %v", err)
	}
	return decoded
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
