import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { decodeChassisPublication } from "../../packages/vehicle-zmq-contract/src/chassis-site.js";
import { decodeChassisFrame } from "../../packages/vehicle-zmq-contract/src/chassis-versioned.js";
import { SiteInteropDeploymentProfile } from "../../packages/vehicle-zmq-contract/src/interop-profile.js";
import { ObservationNormalizer } from "../../packages/vehicle-zmq-observer/src/normalize.js";
import { SceneEnu } from "../../packages/provider-adapter-kit/src/scene-enu.js";
import { settings, clock } from "../ugv-zmq-observer/helpers.js";
import { interopProfile, mapReference } from "../ugv-zmq-provider/dashboard-v2-fixture.js";
import { present } from "../ugv-zmq-control/helpers.js";
const capture = JSON.parse(
  readFileSync("contracts/ugv-zmq/site-interop-v1/chassis-captured.json", "utf8"),
) as { samples: { hex: string; messageId: number }[] };
describe("explicit site chassis publication contract", () => {
  for (const sample of capture.samples)
    it(`decodes captured ${sample.messageId.toString(16)} only with explicit compatibility`, () => {
      const bytes = Buffer.from(sample.hex, "hex");
      expect(() => decodeChassisFrame(bytes, { protocolVersion: "2.1" })).toThrow();
      expect(() => decodeChassisPublication(bytes, { protocolVersion: "2.1" })).toThrow();
      expect(
        decodeChassisPublication(bytes, {
          protocolVersion: "2.1",
          publicationFraming: "prefix_business_length_crc",
          systemId: "1",
        }).messageId,
      ).toBe(sample.messageId);
      const bad = Buffer.from(bytes);
      bad[bad.length - 1] = (bad.at(-1) ?? 0) ^ 1;
      expect(() =>
        decodeChassisPublication(bad, {
          protocolVersion: "2.1",
          publicationFraming: "prefix_business_length_crc",
        }),
      ).toThrow();
    });
  it("does not ignore prefix, lengths, foreign IDs, trailing or truncated bytes", () => {
    const b = Buffer.from(capture.samples[0]?.hex ?? "", "hex"),
      h = b.indexOf(0x3a) + 1;
    const e = {
      protocolVersion: "2.1" as const,
      publicationFraming: "prefix_business_length_crc" as const,
    };
    for (const bad of [b.subarray(0, -1), Buffer.concat([b, Buffer.from([0])])])
      expect(() => decodeChassisPublication(bad, e)).toThrow();
    const bad = Buffer.from(b);
    bad.writeUInt32LE(0, h + 24);
    expect(() => decodeChassisPublication(bad, e)).toThrow("STRING_LENGTH");
    expect(() => decodeChassisPublication(b, { ...e, systemId: "2" })).toThrow();
    expect(() =>
      SiteInteropDeploymentProfile.parse({
        ...interopProfile(),
        components: {
          ...interopProfile().components,
          chassis: {
            ...interopProfile().components.chassis,
            commandFraming: "prefix_business_length_crc",
          },
        },
      }),
    ).toThrow();
  });
  it("retains original raw bytes and explicitly labels compatible observations", () => {
    const receipt = new ObservationNormalizer(interopProfile(), settings()).receive(
      "chassis",
      [Buffer.from(capture.samples[0]?.hex ?? "", "hex")],
      clock(),
    );
    expect(receipt).toMatchObject({
      valid: true,
      projectable: true,
      observation: { protocolVersion: "2.1-site-rx/1", key: "localization" },
    });
    expect(receipt.diagnostics).toContain("CHASSIS_PREFIX_BUSINESS_LENGTH_CRC_COMPATIBILITY");
    expect(Buffer.from(receipt.frames[0]?.base64 ?? "", "base64").toString("hex")).toBe(
      capture.samples[0]?.hex,
    );
  });
});
describe("independent upstream PROJ observations", () => {
  const source = JSON.parse(
    readFileSync("contracts/ugv-zmq/site-interop-v1/enu-reference-observed.json", "utf8"),
  ) as {
    responses: {
      body: {
        position?: { x: number; y: number; z: number };
        gnss?: { longitude: number; latitude: number; altitude: number };
      };
    }[];
  };
  const frame = new SceneEnu(mapReference);
  for (const [i, r] of source.responses.entries())
    if (r.body.position && r.body.gnss)
      it(`matches recorded upstream map transform ${i}`, () => {
        const { x, y, z } = present(r.body.position),
          g = present(r.body.gnss),
          actual = frame.toGnss(x, y, z);
        expect(actual.longitude).toBeCloseTo(g.longitude, 9);
        expect(actual.latitude).toBeCloseTo(g.latitude, 9);
        expect(actual.altitude).toBeCloseTo(g.altitude, 4);
        const round = frame.toMap(g);
        expect(round[0]).toBeCloseTo(x, 4);
        expect(round[1]).toBeCloseTo(y, 4);
        expect(round[2]).toBeCloseTo(z, 4);
      });
});
