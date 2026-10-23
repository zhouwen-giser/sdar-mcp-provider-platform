import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEdgeSubnet, overlaps } from "./network-policy.mjs";
test("rejects device-route overlap independently of Docker allocations", () =>
  assert.throws(() => validateEdgeSubnet("192.168.0.0/24", [], ["192.168.0.63"]), /CONFLICT/));
test("rejects existing container subnets and non-private space", () => {
  assert.throws(() => validateEdgeSubnet("10.252.244.0/24", ["10.252.244.0/26"]), /CONFLICT/);
  assert.throws(() => validateEdgeSubnet("17.26.1.0/24", []), /PRIVATE/);
});
test("accepts a separate explicit station subnet", () =>
  assert.equal(
    validateEdgeSubnet(
      "10.252.244.0/24",
      ["10.252.240.0/24", "17.26.1.0/24", "default"],
      ["192.168.2.63"],
    ),
    "10.252.244.0/24",
  ));
test("compares canonical network ranges and adjacent boundaries", () => {
  assert.equal(overlaps("192.168.0.0/20", "192.168.2.63"), true);
  assert.equal(overlaps("10.252.243.0/24", "10.252.244.0/24"), false);
});
