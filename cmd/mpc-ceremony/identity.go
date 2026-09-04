// Copyright 2026 Midgard Labs
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"proof-tool/internal/mpcceremony"
)

const generatedIdentityKeyIDPrefix = "ed25519:"

func executeIdentityGenerate(options IdentityGenerateOptions) (CommandResult, error) {
	privateTarget, err := resolvedFreshTarget(options.PrivateKeyOut)
	if err != nil {
		return CommandResult{}, fmt.Errorf("private key output: %w", err)
	}
	publicTarget, err := resolvedFreshTarget(options.PublicIdentityOut)
	if err != nil {
		return CommandResult{}, fmt.Errorf("public identity output: %w", err)
	}
	if privateTarget == publicTarget {
		return CommandResult{}, errors.New("private and public output paths must be distinct")
	}
	if err := requireFreshTarget(options.PrivateKeyOut); err != nil {
		return CommandResult{}, fmt.Errorf("private key output: %w", err)
	}
	if err := requireFreshTarget(options.PublicIdentityOut); err != nil {
		return CommandResult{}, fmt.Errorf("public identity output: %w", err)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return CommandResult{}, fmt.Errorf("generate Ed25519 key from operating-system CSPRNG: %w", err)
	}
	defer zeroBytes(privateKey)

	publicKeyDigest := sha256.Sum256(publicKey)
	identity, err := mpcceremony.NewIdentity(
		options.IdentityID,
		options.DisplayName,
		generatedIdentityKeyIDPrefix+hex.EncodeToString(publicKeyDigest[:]),
		publicKey,
	)
	if err != nil {
		return CommandResult{}, fmt.Errorf("create public ceremony identity: %w", err)
	}
	publicIdentity, err := mpcceremony.MarshalCanonical(identity)
	if err != nil {
		return CommandResult{}, fmt.Errorf("encode public ceremony identity: %w", err)
	}

	seed := privateKey.Seed()
	defer zeroBytes(seed)
	privateSeedHex := make([]byte, hex.EncodedLen(len(seed))+1)
	hex.Encode(privateSeedHex, seed)
	privateSeedHex[len(privateSeedHex)-1] = '\n'
	defer zeroBytes(privateSeedHex)

	// Write the non-secret artifact first. A late private-file collision can
	// leave an unusable public identity, but it can never strand private key
	// material or cause an existing file to be overwritten.
	if err := writeFreshOperationalFile(options.PublicIdentityOut, publicIdentity, 0o644); err != nil {
		return CommandResult{}, err
	}
	if err := syncDirectory(filepath.Dir(options.PublicIdentityOut)); err != nil {
		return CommandResult{}, fmt.Errorf("sync public identity directory: %w", err)
	}
	if err := writeFreshOperationalFile(options.PrivateKeyOut, privateSeedHex, 0o600); err != nil {
		return CommandResult{}, fmt.Errorf(
			"write private key (public identity was created but must not be enrolled): %w",
			err,
		)
	}
	if err := syncDirectory(filepath.Dir(options.PrivateKeyOut)); err != nil {
		return CommandResult{}, fmt.Errorf("sync private key directory: %w", err)
	}

	return CommandResult{
		Identity: &identity,
		Outputs: map[string]string{
			"private_key_SECRET": options.PrivateKeyOut,
			"public_identity":    options.PublicIdentityOut,
		},
		Summary: "generated Ed25519 ceremony identity; keep private_key_SECRET local and share only public_identity",
	}, nil
}

func resolvedFreshTarget(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return "", fmt.Errorf("resolve parent directory: %w", err)
	}
	info, err := os.Stat(parent)
	if err != nil {
		return "", fmt.Errorf("inspect parent directory: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("parent is not a directory")
	}
	return filepath.Join(parent, filepath.Base(absolute)), nil
}

func requireFreshTarget(path string) error {
	_, err := os.Lstat(path)
	switch {
	case err == nil:
		return errors.New("output already exists")
	case errors.Is(err, os.ErrNotExist):
		return nil
	default:
		return err
	}
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
