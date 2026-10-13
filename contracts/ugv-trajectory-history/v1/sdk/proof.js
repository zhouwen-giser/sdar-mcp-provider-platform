import { createHash, createPublicKey, sign, verify } from "node:crypto";
import {
  HISTORY_CHAIN_ALGORITHM,
  HistoryManifestSchema,
  ReceptionEntrySchema,
  ReceptionScopeSchema,
  SignedHistoryManifestSchema,
} from "./contract.js";
/** Explicit v1 canonicalization: JSON primitives, finite numbers, sorted UTF-16 object keys. */
export function historyCanonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(historyCanonicalJson).join(",") + "]";
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + historyCanonicalJson(value[key]))
        .join(",") +
      "}"
    );
  throw Error("HISTORY_CANONICAL_JSON_VALUE_INVALID");
}
export const historySha256 = (value) => createHash("sha256").update(value).digest("hex");
export function historyScopeHash(scope) {
  return historySha256(historyCanonicalJson(ReceptionScopeSchema.parse(scope)));
}
export function receptionHash(scope, sequence, previousHash, receipt, recordedAt) {
  return historySha256(
    historyCanonicalJson({
      algorithm: HISTORY_CHAIN_ALGORITHM,
      scopeHash: historyScopeHash(scope),
      sequence,
      previousHash,
      receipt,
      recordedAt,
    }),
  );
}
export function historyKeyId(key) {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "ed25519") throw Error("HISTORY_ED25519_KEY_REQUIRED");
  return historySha256(publicKey.export({ type: "spki", format: "der" }));
}
export function signHistoryManifest(manifest, key) {
  const body = HistoryManifestSchema.parse(manifest);
  return SignedHistoryManifestSchema.parse({
    manifest: body,
    signature: {
      algorithm: "Ed25519",
      keyId: historyKeyId(key),
      value: sign(null, Buffer.from(historyCanonicalJson(body)), key).toString("base64url"),
    },
  });
}
/** The trusted key and expected scope are external inputs, never taken from the supplied proof. */
export function verifyHistoryManifest(input, trustedPublicKey, expectedScope) {
  const signed = SignedHistoryManifestSchema.parse(input);
  const signature = Buffer.from(signed.signature.value, "base64url");
  if (signature.toString("base64url") !== signed.signature.value || signature.length !== 64)
    throw Error("HISTORY_PROOF_SIGNATURE_ENCODING_INVALID");
  if (historyScopeHash(signed.manifest.scope) !== historyScopeHash(expectedScope))
    throw Error("HISTORY_PROOF_SCOPE_MISMATCH");
  if (
    signed.signature.keyId !== historyKeyId(trustedPublicKey) ||
    !verify(null, Buffer.from(historyCanonicalJson(signed.manifest)), trustedPublicKey, signature)
  )
    throw Error("HISTORY_PROOF_SIGNATURE_INVALID");
  return signed.manifest;
}
/** Incremental verifier for a complete retained set. Pagination alone never produces success. */
export class RetainedHistoryVerifier {
  manifest;
  #nextSequence;
  #previousHash;
  #count = 0n;
  #finished = false;
  constructor(signed, key, expectedScope) {
    this.manifest = verifyHistoryManifest(signed, key, expectedScope);
    if (
      this.manifest.retainedHistory.status !== "complete" ||
      this.manifest.previousHash === null ||
      this.manifest.terminalHash === null
    )
      throw Error("HISTORY_RETAINED_SET_NOT_COMPLETE");
    this.#nextSequence = BigInt(this.manifest.fromSequence);
    this.#previousHash = this.manifest.previousHash;
  }
  accept(entryInput) {
    if (this.#finished) throw Error("HISTORY_VERIFIER_ALREADY_FINISHED");
    const entry = ReceptionEntrySchema.parse(entryInput);
    if (
      BigInt(entry.sequence) !== this.#nextSequence ||
      BigInt(entry.sequence) > BigInt(this.manifest.throughSequence) ||
      entry.previousHash !== this.#previousHash ||
      receptionHash(
        this.manifest.scope,
        entry.sequence,
        entry.previousHash,
        entry.receipt,
        entry.recordedAt,
      ) !== entry.hash
    )
      throw Error("HISTORY_ENTRY_CHAIN_INVALID");
    this.#nextSequence++;
    this.#count++;
    this.#previousHash = entry.hash;
    return entry;
  }
  finish(rangeReadFinished) {
    if (
      this.#finished ||
      !rangeReadFinished ||
      this.#count !== BigInt(this.manifest.retainedEntryCount) ||
      this.#previousHash !== this.manifest.terminalHash
    )
      throw Error("HISTORY_RANGE_NOT_FULLY_VERIFIED");
    this.#finished = true;
    return { retainedSetVerified: true, deviceHistoryComplete: false };
  }
}
