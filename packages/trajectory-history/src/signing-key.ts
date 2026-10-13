import { constants, openSync, readFileSync, fstatSync, closeSync } from "node:fs";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { historyKeyId } from "./proof.js";

/** A persistent operator-managed key; no credentials are generated or rotated at service startup. */
export function loadHistorySigningKey(file: string): KeyObject {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 16384)
      throw Error("HISTORY_SIGNING_KEY_PRIVATE_FILE_REQUIRED");
    const key = createPrivateKey(readFileSync(fd));
    historyKeyId(key);
    return key;
  } finally {
    closeSync(fd);
  }
}
