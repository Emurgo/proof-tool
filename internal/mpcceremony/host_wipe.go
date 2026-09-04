package mpcceremony

import (
	"crypto/ed25519"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"
)

const (
	HostWipeAttestationSchema = "proof-tool-mpc-host-wipe-attestation-v1"
	HostWipeRecordFile        = "host-wipe.json"
	HostWipeSignatureFile     = "host-wipe.sig"
)

// HostWipeAttestation is an authenticated participant claim made only after
// the Mac used for contribution has been erased. It is intentionally not
// described as physical proof: software cannot rule out a copy made before
// the wipe. Production release verification uses it as an honest-operator
// gate and checks that it postdates the participant's final contribution.
type HostWipeAttestation struct {
	Schema                                  string `json:"schema"`
	HostWipeID                              string `json:"host_wipe_id"`
	CeremonyID                              string `json:"ceremony_id"`
	ParticipantID                           string `json:"participant_id"`
	ParticipantKeyID                        string `json:"participant_key_id"`
	HostOS                                  string `json:"host_os"`
	WholeDeviceErased                       bool   `json:"whole_device_erased"`
	OperatingSystemReinstalled              bool   `json:"operating_system_reinstalled"`
	NoPreWipeSystemBackupOrSnapshotRestored bool   `json:"no_pre_wipe_system_backup_or_snapshot_restored"`
	NoDockerDesktopStateRestored            bool   `json:"no_docker_desktop_state_restored"`
	NoContributionRandomnessCopyRetained    bool   `json:"no_contribution_randomness_copy_retained"`
	WipedAt                                 string `json:"wiped_at"`
}

func NewHostWipeAttestation(value HostWipeAttestation) (HostWipeAttestation, error) {
	value.Schema = HostWipeAttestationSchema
	value.HostWipeID = ""
	id, err := ComputeHostWipeAttestationID(value)
	if err != nil {
		return HostWipeAttestation{}, err
	}
	value.HostWipeID = id
	return value, value.Validate()
}

func ComputeHostWipeAttestationID(value HostWipeAttestation) (string, error) {
	value.HostWipeID = ""
	if err := value.validate(false); err != nil {
		return "", err
	}
	return canonicalHash("proof-tool/mpc-ceremony/host-wipe-attestation/v1", value)
}

func (a HostWipeAttestation) Validate() error {
	if err := a.validate(true); err != nil {
		return err
	}
	expected, err := ComputeHostWipeAttestationID(a)
	if err != nil {
		return err
	}
	if a.HostWipeID != expected {
		return fmt.Errorf("host_wipe_id %q, want %q", a.HostWipeID, expected)
	}
	return nil
}

func (a HostWipeAttestation) validate(requireID bool) error {
	if a.Schema != HostWipeAttestationSchema {
		return fmt.Errorf("host-wipe schema %q, want %q", a.Schema, HostWipeAttestationSchema)
	}
	if requireID {
		if err := validateHashID("host_wipe_id", a.HostWipeID); err != nil {
			return err
		}
	} else if a.HostWipeID != "" {
		return errors.New("host_wipe_id must be empty while computing identity")
	}
	if err := validateHashID("ceremony_id", a.CeremonyID); err != nil {
		return err
	}
	if err := validateID("participant_id", a.ParticipantID); err != nil {
		return err
	}
	if err := validateID("participant_key_id", a.ParticipantKeyID); err != nil {
		return err
	}
	if a.HostOS != "darwin" {
		return fmt.Errorf("host_os %q, want darwin", a.HostOS)
	}
	if !a.WholeDeviceErased || !a.OperatingSystemReinstalled ||
		!a.NoPreWipeSystemBackupOrSnapshotRestored || !a.NoDockerDesktopStateRestored ||
		!a.NoContributionRandomnessCopyRetained {
		return errors.New("all host-wipe assertions must be true")
	}
	return validateTimestamp("wiped_at", a.WipedAt)
}

func VerifyHostWipeAttestation(
	definition CeremonyDefinition,
	recordBytes, signatureBytes []byte,
) (HostWipeAttestation, error) {
	if err := definition.Validate(); err != nil {
		return HostWipeAttestation{}, err
	}
	var record HostWipeAttestation
	if err := UnmarshalCanonical(recordBytes, &record); err != nil {
		return HostWipeAttestation{}, err
	}
	if record.CeremonyID != definition.CeremonyID ||
		!slices.Contains(definition.HostWipeParticipants, record.ParticipantID) {
		return HostWipeAttestation{}, errors.New("host-wipe attestation is not required by this ceremony and participant")
	}
	participant, ok := definition.ParticipantByID(record.ParticipantID)
	if !ok || participant.Identity.KeyID != record.ParticipantKeyID {
		return HostWipeAttestation{}, errors.New("host-wipe participant identity does not match the signed roster")
	}
	publicKey, err := identityPublicKey(participant.Identity)
	if err != nil {
		return HostWipeAttestation{}, err
	}
	if err := VerifySignedRecord(
		recordBytes,
		signatureBytes,
		&record,
		participant.Identity.KeyID,
		publicKey,
	); err != nil {
		return HostWipeAttestation{}, err
	}
	if err := record.Validate(); err != nil {
		return HostWipeAttestation{}, err
	}
	return record, nil
}

type CreateHostWipeAttestationFilesOptions struct {
	Trust                     TrustPaths
	ParticipantID             string
	ParticipantPrivateKeyPath string
	WipedAt                   string
	OutDir                    string
}

type CreateHostWipeAttestationFilesResult struct {
	Attestation     HostWipeAttestation
	AttestationPath string
	SignaturePath   string
}

func CreateHostWipeAttestationFiles(
	options CreateHostWipeAttestationFilesOptions,
) (result CreateHostWipeAttestationFilesResult, err error) {
	trusted, err := loadOperationalCeremony(options.Trust)
	if err != nil {
		return result, err
	}
	if trusted.Definition.Mode != ModeProduction {
		return result, errors.New("host-wipe attestations apply only to production ceremonies")
	}
	if !slices.Contains(trusted.Definition.HostWipeParticipants, options.ParticipantID) {
		return result, errors.New("participant is not required to provide a host-wipe attestation")
	}
	participant, ok := trusted.Definition.ParticipantByID(options.ParticipantID)
	if !ok {
		return result, errors.New("host-wipe participant is not in the signed roster")
	}
	privateKey, _, err := loadMatchingPrivateKey(options.ParticipantPrivateKeyPath, participant.Identity)
	if err != nil {
		return result, fmt.Errorf("participant signing key: %w", err)
	}
	wipedAt, err := time.Parse(time.RFC3339Nano, options.WipedAt)
	if err != nil {
		return result, errors.New("wiped_at must be RFC3339")
	}
	createdAt, _ := time.Parse(time.RFC3339Nano, trusted.Definition.CreatedAt)
	if !wipedAt.After(createdAt) {
		return result, errors.New("wiped_at must strictly postdate ceremony creation")
	}
	record, err := NewHostWipeAttestation(HostWipeAttestation{
		CeremonyID:                              trusted.Definition.CeremonyID,
		ParticipantID:                           participant.Identity.ID,
		ParticipantKeyID:                        participant.Identity.KeyID,
		HostOS:                                  "darwin",
		WholeDeviceErased:                       true,
		OperatingSystemReinstalled:              true,
		NoPreWipeSystemBackupOrSnapshotRestored: true,
		NoDockerDesktopStateRestored:            true,
		NoContributionRandomnessCopyRetained:    true,
		WipedAt:                                 wipedAt.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return result, err
	}
	if err := os.Mkdir(options.OutDir, 0o700); err != nil {
		return result, fmt.Errorf("create fresh host-wipe output directory: %w", err)
	}
	created := true
	defer func() {
		if err != nil && created {
			_ = os.RemoveAll(options.OutDir)
		}
	}()
	result.AttestationPath = filepath.Join(options.OutDir, HostWipeRecordFile)
	result.SignaturePath = filepath.Join(options.OutDir, HostWipeSignatureFile)
	if err := writeSignedRecordNoReplace(
		result.AttestationPath,
		result.SignaturePath,
		record,
		participant.Identity.KeyID,
		ed25519.PrivateKey(privateKey),
	); err != nil {
		return result, err
	}
	result.Attestation = record
	created = false
	return result, nil
}
