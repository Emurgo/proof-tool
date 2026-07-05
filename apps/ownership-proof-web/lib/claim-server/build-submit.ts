import { blake2b } from "@noble/hashes/blake2b";
import * as LucidExports from "@lucid-evolution/lucid";
import { Constr, Data, type Provider, type UTxO } from "@lucid-evolution/lucid";
import type { ReclaimDeployment, ReclaimReferenceScriptDeployment } from "../reclaim/types";
import {
  DESTINATION_ADDRESS_V1_ENCODING,
  type ClaimBuildRequest,
  type ClaimDraftResponse,
  type ClaimOutRef,
  type ClaimSubmitRequest,
} from "../claim/types";
import {
  assertCborHex,
  assertExactDeploymentId,
  assertHex,
  assertObject,
  assertOutRef,
  assertOutRefList,
  ClaimValidationError,
  outRefToString,
} from "../claim/validation";
import { assertWalletAddresses, assertWalletAddress, assertWalletNetwork } from "../reclaim/validation";
import { createClaimDraft } from "./draft";

const DESTINATION_CIRCUIT_ID = "root-ownership-destination-v1/bls12-381/groth16";
const DESTINATION_PUBLIC_INPUT_DOMAIN = "ROOT-OWNERSHIP-DESTINATION-v1";
const DESTINATION_PUBLIC_INPUT_ENCODING = "single-credential-destination-v1";
const CARDANO_PROOF_FORMAT = "groth16-bls12-381-bsb22";
const PROOF_SCHEMA = "root-ownership-proof-artifact-v1";
const validatorToScriptHash = (LucidExports as unknown as {
  validatorToScriptHash: (script: NonNullable<UTxO["scriptRef"]>) => string;
}).validatorToScriptHash;

type ClaimReferenceScriptRole = "reclaim_base" | "reclaim_global";

type ClaimReferenceScriptInput = {
  role: ClaimReferenceScriptRole;
  outRefId: string;
  holderAddress: string;
  scriptHash: string;
  scriptType: NonNullable<UTxO["scriptRef"]>["type"];
};

type ClaimReferenceScriptsPreflight = {
  ready: boolean;
  missing: string[];
  inputs: ClaimReferenceScriptInput[];
};

export type ClaimBuildPreflight = {
  deploymentId: string;
  draftId: string;
  selectedOutrefs: string[];
  paramsReferenceInput: {
    outRefId: string;
    holderAddress: string;
    datumCbor: string;
  };
  destinationOutputStartIndex: number;
  orderedPaymentCredentials: string[];
  destinationOutputs: ClaimDraftResponse["destinationOutputs"];
  proofSummaries: Array<{
    outRefId: string;
    targetCredential: string;
    destinationAddress: string;
    proofHex: string;
    publicInputDigestHex: string;
  }>;
  referenceScripts: ClaimReferenceScriptsPreflight;
  missingBuildArtifacts: string[];
  buildReady: boolean;
  reclaimGlobalRedeemerCbor: string;
};

type NormalizedProofArtifact = {
  outRefId: string;
  targetCredential: string;
  destinationAddress: string;
  proofHex: string;
  publicInputDigestHex: string;
};

export async function validateClaimBuildRequest(
  provider: Provider,
  deployment: ReclaimDeployment,
  request: ClaimBuildRequest,
): Promise<never> {
  const preflight = await prepareClaimBuildPreflight(provider, deployment, request);
  throw new UnsupportedClaimBuildError(preflight);
}

export async function prepareClaimBuildPreflight(
  provider: Provider,
  deployment: ReclaimDeployment,
  request: ClaimBuildRequest,
): Promise<ClaimBuildPreflight> {
  const raw = assertObject(request, "claim build request") as ClaimBuildRequest;
  assertExactDeploymentId(raw.deploymentId, deployment.id);
  assertWalletNetwork(raw.networkId, deployment.networkId);
  const draftId = assertDraftId(raw.draftId);
  const selectedOutrefs = assertOutRefList(raw.selectedOutrefs, "selectedOutrefs");
  if (selectedOutrefs.length === 0) {
    throw new ClaimValidationError("selected_outrefs_empty", "Claim build requires selected reclaim outrefs.");
  }
  assertWalletAddress(raw.safeWalletChangeAddress, deployment.network);
  assertWalletAddresses(raw.safeWalletAddresses, deployment.network);
  const draft = await createClaimDraft(provider, deployment, {
    deploymentId: deployment.id,
    networkId: deployment.networkId,
    selectedOutrefs,
    safeWalletChangeAddress: raw.safeWalletChangeAddress,
    safeWalletAddresses: raw.safeWalletAddresses,
  });
  if (draft.draftId !== draftId) {
    throw new ClaimValidationError("claim_draft_stale", "Claim draft no longer matches current chain data and safe-wallet destination.");
  }

  const proofs = assertProofArtifacts(raw.proofArtifacts, draft, deployment.verifierVkHash);
  const proofHexes = proofs.map((proof) => proof.proofHex);
  const paramsReferenceInput = await loadParamsReferenceInput(provider, deployment);
  const referenceScripts = await loadClaimReferenceScripts(provider, deployment);

  return {
    deploymentId: deployment.id,
    draftId,
    selectedOutrefs: selectedOutrefs.map(outRefId),
    paramsReferenceInput,
    destinationOutputStartIndex: draft.expectedDestinationOutputStartIndex,
    orderedPaymentCredentials: draft.orderedPaymentCredentials,
    destinationOutputs: draft.destinationOutputs,
    proofSummaries: proofs,
    referenceScripts,
    missingBuildArtifacts: referenceScripts.missing,
    buildReady: referenceScripts.ready,
    reclaimGlobalRedeemerCbor: makeReclaimGlobalRedeemer(
      0,
      draft.expectedDestinationOutputStartIndex,
      proofHexes,
    ),
  };
}

export function validateClaimBuildRequestShape(deployment: ReclaimDeployment, request: ClaimBuildRequest): void {
  const raw = assertObject(request, "claim build request") as ClaimBuildRequest;
  assertExactDeploymentId(raw.deploymentId, deployment.id);
  assertWalletNetwork(raw.networkId, deployment.networkId);
  assertDraftId(raw.draftId);
  const selectedOutrefs = assertOutRefList(raw.selectedOutrefs, "selectedOutrefs");
  if (selectedOutrefs.length === 0) {
    throw new ClaimValidationError("selected_outrefs_empty", "Claim build requires selected reclaim outrefs.");
  }
  assertWalletAddress(raw.safeWalletChangeAddress, deployment.network);
  assertWalletAddresses(raw.safeWalletAddresses, deployment.network);
}

export function validateClaimSubmitRequest(deployment: ReclaimDeployment, request: ClaimSubmitRequest): never {
  const raw = assertObject(request, "claim submit request") as ClaimSubmitRequest;
  assertExactDeploymentId(raw.deploymentId, deployment.id);
  const selectedOutrefs = assertOutRefList(raw.selectedOutrefs, "selectedOutrefs");
  if (selectedOutrefs.length === 0) {
    throw new ClaimValidationError("selected_outrefs_empty", "Claim submit requires selected reclaim outrefs.");
  }
  assertCborHex(raw.signedTxCbor, "signedTxCbor");
  if (typeof raw.claimBuildReviewToken !== "string" || raw.claimBuildReviewToken.trim() === "") {
    throw new ClaimValidationError("claim_submit_review_required", "Claim submit requires a reviewed claim build token.");
  }

  throw new UnsupportedClaimSubmitError();
}

function assertDraftId(value: unknown): string {
  return assertHex(value, "draftId");
}

function assertProofArtifacts(value: unknown, draft: ClaimDraftResponse, expectedVkHash: string): NormalizedProofArtifact[] {
  if (!Array.isArray(value)) {
    throw new ClaimValidationError("proof_artifacts_invalid", "Claim build requires destination-bound proof artifacts.");
  }
  if (value.length !== draft.orderedInputs.length) {
    throw new ClaimValidationError("proof_artifacts_count", "Proof artifact count must match selected reclaim inputs.");
  }

  return value.map((artifact, index) => {
    const expectedInput = draft.orderedInputs[index];
    const expectedOutput = draft.destinationOutputs[index];
    if (!expectedInput || !expectedOutput) {
      throw new ClaimValidationError("proof_artifacts_count", "Proof artifact count must match selected reclaim inputs.");
    }

    const raw = assertObject(artifact, `proofArtifacts[${index}]`);
    if (raw.path !== undefined || raw.paths !== undefined) {
      throw new ClaimValidationError("proof_artifact_path_metadata", "Backend-bound proof artifacts must not include derivation path metadata.");
    }
    const outRefIdValue = raw.out_ref ?? raw.outRef ?? raw.outRefId;
    if (outRefIdValue !== undefined && outRefIdValue !== null && artifactOutRefId(outRefIdValue, `proofArtifacts[${index}].out_ref`) !== expectedInput.outRefId) {
      throw new ClaimValidationError("proof_artifact_outref_order", "Proof artifact out_ref must match backend draft order.");
    }
    const body = assertObject(raw.artifact ?? raw, `proofArtifacts[${index}].artifact`);
    if (body.path !== undefined || body.paths !== undefined) {
      throw new ClaimValidationError("proof_artifact_path_metadata", "Backend-bound proof artifacts must not include derivation path metadata.");
    }
    if (body.schema !== PROOF_SCHEMA) {
      throw new ClaimValidationError("proof_artifact_schema", "Proof artifact schema is not supported.");
    }
    if (body.circuit_id !== DESTINATION_CIRCUIT_ID) {
      throw new ClaimValidationError("proof_artifact_circuit", "Proof artifact circuit id is not destination-bound.");
    }
    if (body.vk_hash !== expectedVkHash) {
      throw new ClaimValidationError("proof_artifact_vk_hash", "Proof artifact verifier key hash does not match deployment.");
    }
    if (body.target_credential !== expectedInput.paymentCredential) {
      throw new ClaimValidationError("proof_artifact_target_credential", "Proof artifact target credential does not match the ordered reclaim datum.");
    }
    if (body.destination_address_encoding !== DESTINATION_ADDRESS_V1_ENCODING) {
      throw new ClaimValidationError("proof_artifact_destination_encoding", "Proof artifact destination encoding is not supported.");
    }
    if (body.destination_address !== expectedOutput.destinationAddress) {
      throw new ClaimValidationError("proof_artifact_destination", "Proof artifact destination does not match the backend-computed destination.");
    }
    if (body.public_input_encoding !== DESTINATION_PUBLIC_INPUT_ENCODING) {
      throw new ClaimValidationError("proof_artifact_public_input_encoding", "Proof artifact public input encoding is not supported.");
    }
    const cardano = assertObject(body.cardano, `proofArtifacts[${index}].artifact.cardano`);
    if (cardano.format !== CARDANO_PROOF_FORMAT) {
      throw new ClaimValidationError("proof_artifact_cardano_format", "Proof artifact Cardano proof format is not supported.");
    }
    const proofHex = assertHex(cardano.proof_hex, `proofArtifacts[${index}].artifact.cardano.proof_hex`);
    const publicInputDigestHex = assertHex(
      cardano.public_input_digest_hex,
      `proofArtifacts[${index}].artifact.cardano.public_input_digest_hex`,
    );
    const expectedDigest = destinationPublicInputDigest(expectedInput.paymentCredential, expectedOutput.destinationAddress);
    if (publicInputDigestHex !== expectedDigest) {
      throw new ClaimValidationError("proof_artifact_public_input_digest", "Proof artifact public input digest does not match credential and destination.");
    }

    return {
      outRefId: expectedInput.outRefId,
      targetCredential: expectedInput.paymentCredential,
      destinationAddress: expectedOutput.destinationAddress,
      proofHex,
      publicInputDigestHex,
    };
  });
}

function destinationPublicInputDigest(credentialHex: string, destinationAddressHex: string): string {
  const preimage = Buffer.concat([
    Buffer.from(DESTINATION_PUBLIC_INPUT_DOMAIN, "utf8"),
    Buffer.from(credentialHex, "hex"),
    Buffer.from(destinationAddressHex, "hex"),
  ]);
  return Buffer.from(blake2b(new Uint8Array(preimage), { dkLen: 32 })).toString("hex");
}

function makeReclaimGlobalRedeemer(paramsIdx: number, destinationOutputStartIndex: number, proofs: string[]): string {
  return Data.to(new Constr(0, [BigInt(paramsIdx), BigInt(destinationOutputStartIndex), proofs]));
}

async function loadParamsReferenceInput(
  provider: Provider,
  deployment: ReclaimDeployment,
): Promise<ClaimBuildPreflight["paramsReferenceInput"]> {
  if (!deployment.paramsUtxo) {
    throw new ClaimValidationError("claim_params_missing", "Reclaim deployment is missing the parameter reference UTxO.");
  }
  const outRef = {
    txHash: deployment.paramsUtxo.tx_hash,
    outputIndex: deployment.paramsUtxo.output_index,
  };
  const outRefIdValue = outRefToString(outRef);
  const utxos = await provider.getUtxosByOutRef([outRef]);
  const paramsUtxo = utxos.find((utxo) => outRefToString(utxo) === outRefIdValue);
  if (!paramsUtxo) {
    throw new ClaimValidationError("claim_params_not_found", "Parameter reference UTxO is spent or unavailable.");
  }
  assertParamsUtxo(paramsUtxo, deployment);
  return {
    outRefId: outRefIdValue,
    holderAddress: paramsUtxo.address,
    datumCbor: paramsUtxo.datum ?? "",
  };
}

function assertParamsUtxo(utxo: UTxO, deployment: ReclaimDeployment): void {
  const params = deployment.paramsUtxo;
  if (!params) {
    throw new ClaimValidationError("claim_params_missing", "Reclaim deployment is missing the parameter reference UTxO.");
  }
  if (utxo.address !== params.holder_address) {
    throw new ClaimValidationError("claim_params_wrong_address", "Parameter reference UTxO is not at the configured holder address.");
  }
  const unit = `${params.policy_id}${params.token_name}`;
  if (utxo.assets[unit] !== 1n) {
    throw new ClaimValidationError("claim_params_token_missing", "Parameter reference UTxO does not contain exactly one configured parameter NFT.");
  }
  for (const [assetUnit, amount] of Object.entries(utxo.assets)) {
    if (assetUnit !== "lovelace" && assetUnit.startsWith(params.policy_id) && (assetUnit !== unit || amount !== 1n)) {
      throw new ClaimValidationError("claim_params_token_mismatch", "Parameter reference UTxO contains unexpected tokens under the parameter policy.");
    }
  }
  const expectedDatum = Data.to(new Constr(0, [deployment.reclaimBaseScriptHash]));
  if (!utxo.datum || utxo.datum.toLowerCase() !== expectedDatum) {
    throw new ClaimValidationError("claim_params_datum_mismatch", "Parameter reference datum does not bind the configured ReclaimBase script hash.");
  }
}

async function loadClaimReferenceScripts(provider: Provider, deployment: ReclaimDeployment): Promise<ClaimReferenceScriptsPreflight> {
  const missing = missingReferenceScriptArtifacts(deployment);
  if (missing.length > 0) {
    return {
      ready: false,
      missing,
      inputs: [],
    };
  }

  const configured = deployment.referenceScripts;
  if (!configured) {
    throw new ClaimValidationError("claim_reference_scripts_missing", "Reclaim deployment is missing claim reference script metadata.");
  }
  const expected = [
    {
      role: "reclaim_base" as const,
      referenceScript: configured.reclaimBase,
      expectedScriptHash: deployment.reclaimBaseScriptHash,
    },
    {
      role: "reclaim_global" as const,
      referenceScript: configured.reclaimGlobal,
      expectedScriptHash: deployment.reclaimGlobalScriptHash,
    },
  ];
  const utxos = await provider.getUtxosByOutRef(expected.map((entry) => referenceScriptOutRef(entry.referenceScript)));
  const inputs = expected.map((entry) => {
    const outRefIdValue = referenceScriptOutRefId(entry.referenceScript);
    const utxo = utxos.find((candidate) => outRefToString(candidate) === outRefIdValue);
    if (!utxo) {
      throw new ClaimValidationError("claim_reference_script_not_found", `${entry.role} reference script UTxO is spent or unavailable.`);
    }
    return assertReferenceScriptUtxo(entry.role, utxo, entry.referenceScript, entry.expectedScriptHash);
  });

  return {
    ready: true,
    missing: [],
    inputs,
  };
}

function missingReferenceScriptArtifacts(deployment: ReclaimDeployment): string[] {
  const missing: string[] = [];
  if (!deployment.referenceScripts?.reclaimBase) {
    missing.push("reference_scripts.reclaim_base");
  }
  if (!deployment.referenceScripts?.reclaimGlobal) {
    missing.push("reference_scripts.reclaim_global");
  }
  return missing;
}

function referenceScriptOutRef(referenceScript: ReclaimReferenceScriptDeployment) {
  return {
    txHash: referenceScript.tx_hash,
    outputIndex: referenceScript.output_index,
  };
}

function referenceScriptOutRefId(referenceScript: ReclaimReferenceScriptDeployment): string {
  return outRefToString(referenceScriptOutRef(referenceScript));
}

function assertReferenceScriptUtxo(
  role: ClaimReferenceScriptRole,
  utxo: UTxO,
  referenceScript: ReclaimReferenceScriptDeployment,
  expectedScriptHash: string,
): ClaimReferenceScriptInput {
  const outRefIdValue = referenceScriptOutRefId(referenceScript);
  if (referenceScript.holder_address && utxo.address !== referenceScript.holder_address) {
    throw new ClaimValidationError("claim_reference_script_wrong_address", `${role} reference script UTxO is not at the configured holder address.`);
  }
  if (referenceScript.script_hash !== expectedScriptHash) {
    throw new ClaimValidationError("claim_reference_script_hash_mismatch", `${role} reference script hash does not match deployment script hash.`);
  }
  if (!utxo.scriptRef) {
    throw new ClaimValidationError("claim_reference_script_missing_script_ref", `${role} reference script UTxO is missing a reference script.`);
  }
  if (utxo.scriptRef.type !== "PlutusV3") {
    throw new ClaimValidationError("claim_reference_script_wrong_type", `${role} reference script must be PlutusV3.`);
  }
  const actualScriptHash = referenceScriptHash(role, utxo.scriptRef);
  if (actualScriptHash !== referenceScript.script_hash) {
    throw new ClaimValidationError("claim_reference_script_hash_mismatch", `${role} reference script hash does not match the scriptRef bytes.`);
  }
  return {
    role,
    outRefId: outRefIdValue,
    holderAddress: utxo.address,
    scriptHash: actualScriptHash,
    scriptType: utxo.scriptRef.type,
  };
}

function referenceScriptHash(role: ClaimReferenceScriptRole, scriptRef: NonNullable<UTxO["scriptRef"]>): string {
  try {
    return validatorToScriptHash(scriptRef).toLowerCase();
  } catch {
    throw new ClaimValidationError("claim_reference_script_invalid", `${role} reference script bytes are invalid.`);
  }
}

function outRefId(value: string | ClaimOutRef): string {
  if (typeof value === "string") {
    return value;
  }
  return `${value.txHash}#${value.outputIndex}`;
}

function artifactOutRefId(value: unknown, field: string): string {
  return outRefToString(assertOutRef(value, field));
}

export class UnsupportedClaimBuildError extends Error {
  readonly code = "claim_build_unsupported";
  readonly preflight?: ClaimBuildPreflight;
  readonly reason: string;
  readonly missingBuildArtifacts: string[];

  constructor(preflight?: ClaimBuildPreflight) {
    super("Live claim transaction construction is not enabled for this deployment.");
    this.name = "UnsupportedClaimBuildError";
    this.preflight = preflight;
    this.reason = preflight?.buildReady ? "transaction_builder_not_implemented" : "build_prerequisites_missing";
    this.missingBuildArtifacts = preflight?.missingBuildArtifacts ?? [];
  }
}

export class UnsupportedClaimSubmitError extends Error {
  readonly code = "claim_submit_unsupported";

  constructor() {
    super("Live claim transaction submission is not enabled for this deployment.");
    this.name = "UnsupportedClaimSubmitError";
  }
}
