import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config.js";
import { makeCredentials } from "../server/security.js";
const env = {
  UGV_CONSOLE_CREDENTIALS: JSON.stringify(makeCredentials("operator", "fixture-http-password")),
  UGV_CONSOLE_DATABASE_URL: "postgresql://fixture@127.0.0.1/fixture",
  UGV_CONSOLE_HOST: "0.0.0.0",
  UGV_CONSOLE_ORIGINS: "http://17.26.1.20:19101",
  UGV_CONSOLE_TLS_KEY_FILE: "/missing-http-test/key",
  UGV_CONSOLE_TLS_CERT_FILE: "/missing-http-test/cert",
};
describe("LAN HTTP configuration", () => {
  it.each([undefined, "http"])("supports HTTP without TLS files (protocol=%s)", (protocol) => {
    const config = loadConfig({ ...env, UGV_CONSOLE_PROTOCOL: protocol });
    expect(config.host).toBe("0.0.0.0");
    expect(config.secure).toBe(false);
    expect(config.tls).toBeUndefined();
    expect(config.origins).toEqual(["http://17.26.1.20:19101"]);
  });
  it("rejects unsupported transport and an origin with a different scheme", () => {
    expect(() => loadConfig({ ...env, UGV_CONSOLE_PROTOCOL: "ftp" })).toThrow(
      "CONSOLE_PROTOCOL_INVALID",
    );
    expect(() => loadConfig({ ...env, UGV_CONSOLE_ORIGINS: "https://17.26.1.20:19101" })).toThrow(
      "CONSOLE_ORIGIN_INVALID",
    );
  });
  it("keeps the explicit development loopback binding constraint", () => {
    expect(() => loadConfig({ ...env, UGV_CONSOLE_INSECURE_LOCAL: "true" })).toThrow(
      "CONSOLE_INSECURE_REQUIRES_LOOPBACK",
    );
  });
});
