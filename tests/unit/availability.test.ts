import { describe, expect, it } from "vitest";
import {
  unknownAvailability,
  validateAvailabilityResponse,
} from "../../packages/domain/src/index.js";

const checks = [
  { requestId: "one", operationName: "op", arguments: { state: "complete" as const, value: {} } },
  { requestId: "two", operationName: "op", arguments: { state: "complete" as const, value: {} } },
];
const firstCheck = {
  requestId: "one",
  operationName: "op",
  arguments: { state: "complete" as const, value: {} },
};

describe("availability contract", () => {
  it("validates available/restricted results and ordered windows", () => {
    const checkedAt = new Date("2026-07-16T00:00:00Z");
    expect(
      validateAvailabilityResponse(checkedAt, checks, [
        {
          requestId: "one",
          operationName: "op",
          availability: "available",
          reservationMode: "none",
          validUntil: "2026-07-16T00:00:10Z",
        },
        {
          requestId: "two",
          operationName: "op",
          availability: "restricted",
          reservationMode: "none",
          reasonCode: "BUSY",
          riskLevel: "high",
          validUntil: "2026-07-16T00:00:10Z",
          possibleEffects: ["start_rejection"],
          nextAvailableWindows: [
            { startTime: "2026-07-16T00:01:00Z", endTime: "2026-07-16T00:02:00Z" },
          ],
        },
      ]).results,
    ).toHaveLength(2);
  });

  it("rejects invalid validity and restricted/window contracts", () => {
    expect(() =>
      validateAvailabilityResponse(
        new Date(),
        [firstCheck],
        [
          {
            requestId: "one",
            operationName: "op",
            availability: "restricted",
            reservationMode: "none",
            riskLevel: "high",
            validUntil: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      ),
    ).toThrow("RESTRICTED_AVAILABILITY_FIELDS_MISSING");
    expect(() =>
      validateAvailabilityResponse(
        new Date("2026-01-01T00:00:00Z"),
        [firstCheck],
        [
          {
            requestId: "one",
            operationName: "op",
            availability: "restricted",
            reservationMode: "none",
            reasonCode: "BUSY",
            riskLevel: "high",
            validUntil: "2026-01-02T00:00:00Z",
            possibleEffects: [],
            nextAvailableWindows: [
              {
                startTime: "2026-01-03T00:00:00Z",
                endTime: "2026-01-02T00:00:00Z",
              },
            ],
          },
        ],
      ),
    ).toThrow("INVALID_AVAILABILITY_WINDOW");
  });

  it("enforces guaranteed reservation references", () => {
    const base = {
      requestId: "one",
      operationName: "op",
      availability: "available" as const,
      riskLevel: "low" as const,
    };
    expect(() =>
      validateAvailabilityResponse(
        new Date(),
        [firstCheck],
        [{ ...base, reservationMode: "guaranteed" }],
      ),
    ).toThrow("AVAILABILITY_RESERVATION_INVALID");
    expect(() =>
      validateAvailabilityResponse(
        new Date(),
        [firstCheck],
        [{ ...base, reservationMode: "best_effort", reservationRef: "not-guaranteed" }],
      ),
    ).toThrow("AVAILABILITY_RESERVATION_INVALID");
  });

  it("requires an explicit reservation mode", () => {
    expect(() =>
      validateAvailabilityResponse(
        new Date(),
        [firstCheck],
        [
          {
            requestId: "one",
            operationName: "op",
            availability: "available",
          } as never,
        ],
      ),
    ).toThrow("AVAILABILITY_RESERVATION_MODE_MISSING");
  });

  it("uses explicit unknown fallback without claiming availability", () => {
    const fallback = unknownAvailability(checks);
    expect(fallback.results.map((check) => check.requestId)).toEqual(["one", "two"]);
    expect(fallback.results.map((check) => check.availability)).toEqual(["unknown", "unknown"]);
    expect(fallback.results.map((check) => check.reservationMode)).toEqual(["none", "none"]);
    expect(fallback.results.map((check) => check.reasonCode)).toEqual([
      "ADAPTER_TRANSIENT_UNAVAILABLE",
      "ADAPTER_TRANSIENT_UNAVAILABLE",
    ]);
  });
});
