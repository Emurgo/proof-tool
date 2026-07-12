package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"proof-tool/internal/prover"
)

func TestParseStage2gDestination(t *testing.T) {
	addressBytes := strings.Repeat("ab", stage2gDestinationByteCount)
	got, err := parseStage2gDestination("addr_test1stage2gdestination", addressBytes)
	if err != nil {
		t.Fatalf("parseStage2gDestination() error = %v", err)
	}
	if len(got) != stage2gDestinationByteCount {
		t.Fatalf("destination length = %d, want %d", len(got), stage2gDestinationByteCount)
	}
	if _, err := parseStage2gDestination("addr1mainnet", addressBytes); err == nil {
		t.Fatal("mainnet destination unexpectedly accepted")
	}
}

func TestValidateStage2gCardanoVKRequiresExactCommitmentLength(t *testing.T) {
	if prover.CardanoVKCommitmentLen != 672 {
		t.Fatalf("Cardano commitment VK length = %d, want 672", prover.CardanoVKCommitmentLen)
	}
	for _, length := range []int{671, 673} {
		if err := validateStage2gCardanoVK(make([]byte, length), "groth16-bls12-381-bsb22"); err == nil {
			t.Fatalf("validateStage2gCardanoVK accepted %d-byte VK", length)
		}
	}
	if err := validateStage2gCardanoVK(make([]byte, 672), "groth16-bls12-381-bsb22"); err != nil {
		t.Fatalf("validateStage2gCardanoVK rejected exact 672-byte commitment VK: %v", err)
	}
	if err := validateStage2gCardanoVK(make([]byte, 672), "groth16-bls12-381"); err == nil {
		t.Fatal("validateStage2gCardanoVK accepted vanilla VK format")
	}
}

func TestValidateStage2gCardanoProofRequiresExactCommitmentLength(t *testing.T) {
	if prover.CardanoProofCommitmentLen != 336 {
		t.Fatalf("Cardano commitment proof length = %d, want 336", prover.CardanoProofCommitmentLen)
	}
	for _, length := range []int{335, 337} {
		if err := validateStage2gCardanoProofArtifact("groth16-bls12-381-bsb22", strings.Repeat("ab", length), strings.Repeat("cd", 32)); err == nil {
			t.Fatalf("validateStage2gCardanoProofArtifact accepted %d-byte proof", length)
		}
	}
	if err := validateStage2gCardanoProofArtifact("groth16-bls12-381-bsb22", strings.Repeat("ab", 336), strings.Repeat("cd", 32)); err != nil {
		t.Fatalf("validateStage2gCardanoProofArtifact rejected exact 336-byte commitment proof: %v", err)
	}
	if err := validateStage2gCardanoProofArtifact("groth16-bls12-381", strings.Repeat("ab", 336), strings.Repeat("cd", 32)); err == nil {
		t.Fatal("validateStage2gCardanoProofArtifact accepted vanilla proof format")
	}
}

func TestReadStage2gCompromisedMasterDoesNotEchoMnemonic(t *testing.T) {
	const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	path := filepath.Join(t.TempDir(), "wallets.json")
	contents := `{"wallets":{"compromised_user":{"mnemonic":"` + mnemonic + `"}}}`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	master, err := readStage2gCompromisedMaster(path)
	if err != nil {
		t.Fatalf("readStage2gCompromisedMaster() error = %v", err)
	}
	if len(master) != 96 {
		t.Fatalf("master length = %d, want 96", len(master))
	}
	clear(master)

	missingPath := filepath.Join(t.TempDir(), "missing.json")
	if _, err := readStage2gCompromisedMaster(missingPath); err == nil || strings.Contains(err.Error(), mnemonic) {
		t.Fatalf("missing wallet error leaked mnemonic or did not fail: %v", err)
	}
}

func TestCmdGenerateStage2gV2MaterialDoesNotEchoUnexpectedPositionalArgument(t *testing.T) {
	const sensitiveArgument = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	err := cmdGenerateStage2gV2Material([]string{sensitiveArgument})
	if err == nil {
		t.Fatal("cmdGenerateStage2gV2Material accepted an unexpected positional argument")
	}
	if strings.Contains(err.Error(), sensitiveArgument) {
		t.Fatalf("unexpected positional argument leaked through the error: %v", err)
	}
}

func TestStage2gTrustedManifestPublicKeyRejectsBundledPublicKeyFile(t *testing.T) {
	keysDir := t.TempDir()
	bundledPublicKey := filepath.Join(keysDir, manifestPublicKeyFile)
	if err := os.WriteFile(bundledPublicKey, []byte(strings.Repeat("ab", 32)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := stage2gTrustedManifestPublicKey(keysDir, bundledPublicKey); err == nil {
		t.Fatal("stage2gTrustedManifestPublicKey accepted a trust anchor from inside --keys-dir")
	}
}

func TestStage2gTrustedManifestPublicKeyAcceptsExternalRegularFile(t *testing.T) {
	keysDir := t.TempDir()
	trustedPublicKey := filepath.Join(t.TempDir(), "trusted-manifest-public-key.hex")
	want := strings.Repeat("ab", 32)
	if err := os.WriteFile(trustedPublicKey, []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := stage2gTrustedManifestPublicKey(keysDir, trustedPublicKey)
	if err != nil {
		t.Fatalf("stage2gTrustedManifestPublicKey() error = %v", err)
	}
	if got != want {
		t.Fatalf("trusted public key = %q, want %q", got, want)
	}
}

func TestWriteStage2gMaterialIsPrivateAndExclusive(t *testing.T) {
	repoRoot := t.TempDir()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(repoRoot); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(workingDirectory)
	out := filepath.Join("output", "preprod-e2e", "stage2g-v2", "nested", "material.json")
	material := stage2gMaterial{Schema: stage2gMaterialSchema, Network: stage2gNetwork, Policy: stage2gFixedPolicy()}
	if err := writeStage2gMaterial(out, material); err != nil {
		t.Fatalf("writeStage2gMaterial() error = %v", err)
	}
	info, err := os.Stat(out)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("material mode = %o, want 600", got)
	}
	if err := writeStage2gMaterial(out, material); err == nil {
		t.Fatal("writeStage2gMaterial overwrote an existing material file")
	}
	if err := writeStage2gMaterial(filepath.Join(repoRoot, "outside.json"), material); err == nil {
		t.Fatal("writeStage2gMaterial accepted an output outside its dedicated directory")
	}
	if err := writeStage2gMaterial(filepath.Join(repoRoot, "output", "preprod-e2e", "stage2g-v2", "absolute.json"), material); err == nil {
		t.Fatal("writeStage2gMaterial accepted an absolute output path")
	}
}

func TestWriteStage2gMaterialRejectsExistingIntermediateSymlink(t *testing.T) {
	repoRoot := t.TempDir()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(repoRoot); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(workingDirectory)

	stageRoot := filepath.Join("output", "preprod-e2e", "stage2g-v2")
	if err := os.MkdirAll(stageRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	escapedDirectory := filepath.Join(repoRoot, "outside-stage2g-root")
	if err := os.MkdirAll(escapedDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	redirect := filepath.Join(stageRoot, "redirect")
	if err := os.Symlink(escapedDirectory, redirect); err != nil {
		t.Fatal(err)
	}

	materialPath := filepath.Join(redirect, "material.json")
	material := stage2gMaterial{Schema: stage2gMaterialSchema, Network: stage2gNetwork, Policy: stage2gFixedPolicy()}
	if err := writeStage2gMaterial(materialPath, material); err == nil {
		t.Fatal("writeStage2gMaterial accepted an output through an intermediate symbolic link")
	}
	if _, err := os.Lstat(filepath.Join(escapedDirectory, "material.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("writeStage2gMaterial wrote through an intermediate symbolic link: %v", err)
	}
}

func TestStage2gSyntheticHashesAreStableAndDistinct(t *testing.T) {
	first := stage2gSyntheticHash("params-utxo")
	if len(first) != 64 || first != stage2gSyntheticHash("params-utxo") {
		t.Fatalf("synthetic hash is not stable 32-byte hex: %q", first)
	}
	if first == stage2gSyntheticHash("bootstrap-0") {
		t.Fatal("different synthetic labels produced the same outref hash")
	}
}
