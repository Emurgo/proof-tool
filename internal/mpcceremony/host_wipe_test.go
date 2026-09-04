package mpcceremony

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHostWipeAttestationAndReleaseGate(t *testing.T) {
	definition := adversarialDefinition(t)
	definition.HostWipeParticipants = []string{"participant-01"}
	var err error
	definition, err = FinalizeCeremonyDefinition(definition)
	if err != nil {
		t.Fatal(err)
	}
	record, err := NewHostWipeAttestation(HostWipeAttestation{
		CeremonyID:                              definition.CeremonyID,
		ParticipantID:                           "participant-01",
		ParticipantKeyID:                        definition.Roster[0].Identity.KeyID,
		HostOS:                                  "darwin",
		WholeDeviceErased:                       true,
		OperatingSystemReinstalled:              true,
		NoPreWipeSystemBackupOrSnapshotRestored: true,
		NoDockerDesktopStateRestored:            true,
		NoContributionRandomnessCopyRetained:    true,
		WipedAt:                                 "2026-07-23T15:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	recordBytes, signatureBytes, err := SignRecord(
		record,
		definition.Roster[0].Identity.KeyID,
		adversarialPrivateKey(0x11),
	)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := VerifyHostWipeAttestation(definition, recordBytes, signatureBytes)
	if err != nil || verified.HostWipeID != record.HostWipeID {
		t.Fatalf("verify host wipe = %#v, %v", verified, err)
	}
	tamperedSignature := append([]byte(nil), signatureBytes...)
	tamperedSignature[len(tamperedSignature)-1] ^= 1
	if _, err := VerifyHostWipeAttestation(definition, recordBytes, tamperedSignature); err == nil {
		t.Fatal("tampered host-wipe signature accepted")
	}

	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string, raw []byte) ArtifactRef {
		t.Helper()
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		return ArtifactRef{Name: name, Digest: NewDigest(raw)}
	}
	contribution, err := NewContributionAttestation(ContributionAttestation{
		CeremonyID: definition.CeremonyID, Phase: Phase2,
		PhaseID: "sha256:" + strings.Repeat("c", 64), Index: 1,
		ParticipantID: "participant-01", ParticipantKeyID: definition.Roster[0].Identity.KeyID,
		PreviousPayload:      ArtifactRef{Name: "phase2/genesis.bin", Digest: NewDigest([]byte("before"))},
		OutputPayload:        ArtifactRef{Name: "phase2/contribution.bin", Digest: NewDigest([]byte("after"))},
		PreviousAcceptanceID: "sha256:" + strings.Repeat("d", 64),
		ToolBinary:           definition.Software.ToolBinary, SourceCommit: definition.Software.SourceCommit,
		GnarkVersion: GnarkVersion, GnarkCryptoVersion: GnarkCryptoVersion, DrandVersion: DrandVersion,
		Environment: ContributionEnvironment{
			OS: "linux", Architecture: "arm64", EntropySource: "operating-system-csprng",
			SwapDisabled: true, CrashDumpsDisabled: true, TelemetryDisabled: true,
			EphemeralEnvironment: true, EphemeralDestructionRequired: true,
		},
		ContributedAt: "2026-07-23T14:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	attestationBytes, err := MarshalCanonical(contribution)
	if err != nil {
		t.Fatal(err)
	}
	attestation := write("phase2/contributions/0001/attestation.json", attestationBytes)
	phaseID := "sha256:" + strings.Repeat("c", 64)
	genesis := contribution.PreviousPayload
	acceptedChain, err := NewChain(definition.CeremonyID, Phase2, phaseID, genesis)
	if err != nil {
		t.Fatal(err)
	}
	previousRecordID, err := GenesisRecordID(definition.CeremonyID, phaseID, genesis)
	if err != nil {
		t.Fatal(err)
	}
	chainRecord, err := NewChainRecord(ChainRecord{
		CeremonyID:           definition.CeremonyID,
		Phase:                Phase2,
		PhaseID:              phaseID,
		Index:                1,
		ParticipantID:        "participant-01",
		PreviousPayload:      contribution.PreviousPayload,
		OutputPayload:        contribution.OutputPayload,
		AttestationID:        contribution.AttestationID,
		Attestation:          attestation,
		AttestationSignature: ArtifactRef{Name: "phase2/contributions/0001/attestation.sig", Digest: NewDigest([]byte("attestation signature"))},
		ErasureID:            "sha256:" + strings.Repeat("e", 64),
		Erasure:              ArtifactRef{Name: "phase2/contributions/0001/erasure.json", Digest: NewDigest([]byte("erasure"))},
		ErasureSignature:     ArtifactRef{Name: "phase2/contributions/0001/erasure.sig", Digest: NewDigest([]byte("erasure signature"))},
		Verification:         ArtifactRef{Name: "phase2/contributions/0001/verification.json", Digest: NewDigest([]byte("verification"))},
		PreviousRecordID:     previousRecordID,
		CoordinatorID:        definition.Coordinator.ID,
		CoordinatorKeyID:     definition.Coordinator.KeyID,
		AcceptedAt:           "2026-07-23T14:30:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := acceptedChain.Append(chainRecord); err != nil {
		t.Fatal(err)
	}
	chainBytes, err := MarshalCanonical(acceptedChain)
	if err != nil {
		t.Fatal(err)
	}
	chain := write("phase2/chain.json", chainBytes)
	emptyGenesis := ArtifactRef{Name: "phase1/genesis.bin", Digest: NewDigest([]byte("phase1 genesis"))}
	emptyChainModel, err := NewChain(
		definition.CeremonyID,
		Phase1,
		"sha256:"+strings.Repeat("f", 64),
		emptyGenesis,
	)
	if err != nil {
		t.Fatal(err)
	}
	emptyChainBytes, err := MarshalCanonical(emptyChainModel)
	if err != nil {
		t.Fatal(err)
	}
	emptyChain := write("phase1/chain.json", emptyChainBytes)
	wipeRecord := write("host-wipes/participant-01.json", recordBytes)
	wipeSignature := write("host-wipes/participant-01.sig", signatureBytes)
	bundle := OperationalEvidenceBundle{
		HostWipes: []SignedArtifactRefs{{Record: wipeRecord, Signature: wipeSignature}},
		Phase1:    PhaseOperationalEvidence{AcceptedChain: SignedArtifactRefs{Record: emptyChain}},
		Phase2:    PhaseOperationalEvidence{AcceptedChain: SignedArtifactRefs{Record: chain}},
	}
	if _, err := verifyHostWipeEvidence(definition, root, bundle); err != nil {
		t.Fatalf("valid release host-wipe gate: %v", err)
	}

	missing := bundle
	missing.HostWipes = nil
	if _, err := verifyHostWipeEvidence(definition, root, missing); err == nil ||
		!strings.Contains(err.Error(), "want exactly 1") {
		t.Fatalf("missing host wipe error = %v", err)
	}

	tooEarly := record
	tooEarly.WipedAt = "2026-07-23T13:00:00Z"
	tooEarly.HostWipeID = ""
	tooEarly, err = NewHostWipeAttestation(tooEarly)
	if err != nil {
		t.Fatal(err)
	}
	earlyBytes, earlySignature, err := SignRecord(
		tooEarly,
		definition.Roster[0].Identity.KeyID,
		adversarialPrivateKey(0x11),
	)
	if err != nil {
		t.Fatal(err)
	}
	bundle.HostWipes[0] = SignedArtifactRefs{
		Record:    write("host-wipes/too-early.json", earlyBytes),
		Signature: write("host-wipes/too-early.sig", earlySignature),
	}
	if _, err := verifyHostWipeEvidence(definition, root, bundle); err == nil ||
		!strings.Contains(err.Error(), "does not postdate") {
		t.Fatalf("early host wipe error = %v", err)
	}
}

func TestHostWipeDefinitionPolicyIsFrozenAndOrdered(t *testing.T) {
	definition := adversarialDefinition(t)
	definition.HostWipeParticipants = []string{"participant-02", "participant-01"}
	if _, err := FinalizeCeremonyDefinition(definition); err == nil ||
		!strings.Contains(err.Error(), "must be sorted") {
		t.Fatalf("unsorted host-wipe policy error = %v", err)
	}

	definition.HostWipeParticipants = []string{"participant-99"}
	if _, err := FinalizeCeremonyDefinition(definition); err == nil ||
		!strings.Contains(err.Error(), "not in the signed roster") {
		t.Fatalf("unknown host-wipe participant error = %v", err)
	}

	definition = adversarialDefinition(t)
	definition.Mode = ModeRehearsal
	definition.HostWipeParticipants = []string{"participant-01"}
	if _, err := FinalizeCeremonyDefinition(definition); err == nil ||
		!strings.Contains(err.Error(), "rehearsal ceremony") {
		t.Fatalf("rehearsal host-wipe policy error = %v", err)
	}
}

func TestHostWipeTimestampParsesNanoseconds(t *testing.T) {
	value := time.Date(2026, 7, 23, 15, 0, 0, 123, time.UTC).Format(time.RFC3339Nano)
	if err := (HostWipeAttestation{
		Schema: HostWipeAttestationSchema, HostWipeID: "sha256:" + strings.Repeat("a", 64),
		CeremonyID: "sha256:" + strings.Repeat("b", 64), ParticipantID: "participant-01",
		ParticipantKeyID: "participant-key", HostOS: "darwin", WholeDeviceErased: true,
		OperatingSystemReinstalled: true, NoPreWipeSystemBackupOrSnapshotRestored: true,
		NoDockerDesktopStateRestored: true, NoContributionRandomnessCopyRetained: true, WipedAt: value,
	}).validate(true); err != nil {
		t.Fatal(err)
	}
}
