import { present } from "../ugv-zmq-control/helpers.js";
import { describe, expect, it } from "vitest";
import {
  nativeCatalogReason,
  nativeContract,
} from "../../apps/ugv-control-console/shared/zmq-native.js";
import { checkInteropContracts } from "../../scripts/ugv-zmq/interop-contract.js";
import { checkPlannerAdmissionContracts } from "../../scripts/ugv-zmq/planner-admission-contract.js";
import { SitePlannerAdmissionProfile } from "../../packages/vehicle-zmq-contract/src/planner-admission-profile.js";
import { interopProfile } from "./dashboard-v2-fixture.js";
import control from "../../contracts/ugv-zmq/provider-v1.5.2-site-control/catalog.json" with { type: "json" };
import readonly from "../../contracts/ugv-zmq/provider-v1.5.2-readonly/catalog.json" with { type: "json" };
describe("1.5.2 exact catalog and explicit policy", () => {
  it.each([control, readonly])("accepts only the complete exact $profile contract", (catalog) => {
    const tools = catalog.tools.map((t) =>
      present(nativeContract(t.name, "vehicle:TEST", catalog.profile)),
    );
    expect(tools).toHaveLength(15);
    expect(nativeCatalogReason(tools, "vehicle:TEST")).toBeNull();
    expect(nativeCatalogReason(tools.slice(1), "vehicle:TEST")).toBe(
      "ZMQ_NATIVE_TOOL_SET_MISMATCH",
    );
    const changed = structuredClone(tools);
    present(changed.find((t) => t.name === "vehicle_zmq_plan_route")).outputSchema = {};
    expect(nativeCatalogReason(changed, "vehicle:TEST")).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
  });
  it("preserves the original frozen parent hash", () => {
    expect(checkInteropContracts().contractSha256).toBe(
      "0e2df6125e060d997cdc9eedd986cd2863592fbcecc6bb7210c7b47627efa2f5",
    );
    expect(checkPlannerAdmissionContracts().status).toBe("verified");
  });
  it("requires explicit policy and preserves inherited endpoint/identity constraints", () => {
    const base = interopProfile();
    const profile = {
      ...base,
      schemaVersion: "ugv.zmq-site-deployment/4",
      planner: { ...base.planner, readinessPolicy: "runtime_scene_and_entity_v1" },
    };
    expect(SitePlannerAdmissionProfile.safeParse(profile).success).toBe(true);
    expect(
      SitePlannerAdmissionProfile.safeParse({
        ...profile,
        planner: { ...profile.planner, readinessPolicy: undefined },
      }).success,
    ).toBe(false);
    expect(
      SitePlannerAdmissionProfile.safeParse({
        ...profile,
        planner: { ...profile.planner, systemId: "999" },
      }).success,
    ).toBe(false);
    const wrong = structuredClone(profile);
    wrong.components.eo.publicationEndpoint = wrong.components.chassis.commandEndpoint;
    expect(SitePlannerAdmissionProfile.safeParse(wrong).success).toBe(false);
  });
});
