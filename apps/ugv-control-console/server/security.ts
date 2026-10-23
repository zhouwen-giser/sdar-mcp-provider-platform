import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Credentials } from "./config.js";
export function makeCredentials(username: string, password: string): Credentials {
  if (!username.trim() || password.length < 12) throw Error("CONSOLE_PASSWORD_TOO_SHORT");
  const salt = randomBytes(24).toString("hex");
  return {
    username,
    salt,
    passwordHash: scryptSync(password, salt, 64).toString("hex"),
    sessionSecret: randomBytes(48).toString("hex"),
  };
}
export function passwordMatches(c: Credentials, username: string, password: string): boolean {
  const hash = scryptSync(password, c.salt, 64),
    expected = Buffer.from(c.passwordHash, "hex");
  return (
    hash.length === expected.length && timingSafeEqual(hash, expected) && username === c.username
  );
}
export function session(c: Credentials, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({
      subject: c.username,
      expires: now + 8 * 3600000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", c.sessionSecret).update(body).digest("base64url")}`;
}
export function sessionToken(cookie: string | undefined, name = "ugv_session") {
  return (
    (cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
export function verifySession(
  c: Credentials,
  cookie: string | undefined,
  now = Date.now(),
  name = "ugv_session",
): boolean {
  try {
    const token = sessionToken(cookie, name);
    if (!token) return false;
    const [body, signature, ...rest] = token.split(".");
    if (!body || !signature || rest.length) return false;
    const expected = createHmac("sha256", c.sessionSecret).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      subject?: unknown;
      expires?: unknown;
    };
    return (
      payload.subject === c.username && typeof payload.expires === "number" && payload.expires > now
    );
  } catch {
    return false;
  }
}
