package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEd25519SigningKeyRoundTrip(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "release.ed25519.private.hex")
	privateKey, publicKey, generated, err := readOrCreateEd25519SigningKey(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if !generated {
		t.Fatal("new key was not reported as generated")
	}
	if len(privateKey) != ed25519.PrivateKeySize {
		t.Fatalf("private key size = %d", len(privateKey))
	}
	if len(publicKey) != ed25519.PublicKeySize {
		t.Fatalf("public key size = %d", len(publicKey))
	}

	privateKey2, publicKey2, generated2, err := readOrCreateEd25519SigningKey(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if generated2 {
		t.Fatal("existing key was regenerated")
	}
	if hex.EncodeToString(privateKey2) != hex.EncodeToString(privateKey) {
		t.Fatal("private key changed")
	}
	if hex.EncodeToString(publicKey2) != hex.EncodeToString(publicKey) {
		t.Fatal("public key changed")
	}
	if _, err := os.Stat(publicSigningKeyPath(keyPath)); err != nil {
		t.Fatalf("public key file missing: %v", err)
	}
}

func TestVerifyManifestSignature(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")
	signaturePath := filepath.Join(dir, "manifest.sig")
	_, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	publicKey := privateKey.Public().(ed25519.PublicKey)
	manifest := []byte("{\"schema\":\"test\"}\n")
	if err := os.WriteFile(manifestPath, manifest, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(signaturePath, []byte(hex.EncodeToString(ed25519.Sign(privateKey, manifest))+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyManifestSignature(manifestPath, signaturePath, hex.EncodeToString(publicKey)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, []byte("{\"schema\":\"tampered\"}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	err = verifyManifestSignature(manifestPath, signaturePath, hex.EncodeToString(publicKey))
	if err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("tampered manifest err = %v", err)
	}
}

func TestEnsureFreshDirectoryRejectsNonEmpty(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := ensureFreshDirectory(dir)
	if err == nil || !strings.Contains(err.Error(), "not empty") {
		t.Fatalf("err = %v", err)
	}
}
