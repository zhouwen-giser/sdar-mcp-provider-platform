import { describe, it, expect } from "vitest";
import { Ajv } from "ajv";
import { present } from "../ugv-zmq-control/helpers.js";
import { siteControlV14CatalogContract } from "../../scripts/ugv-zmq/site-control-v14-catalog.js";
import { siteControlV13CatalogContract } from "../../scripts/ugv-zmq/site-control-v13-catalog.js";
import {
  VIEW_TOOL,
  ViewParameters,
  validateViewReply,
} from "../../packages/vehicle-zmq-control/src/simulation-view-contract.js";
import { SimulationViewClient } from "../../packages/vehicle-zmq-control/src/simulation-view-client.js";
import type { WireCommand } from "../../packages/vehicle-zmq-control/src/model.js";
import { canonical, sha256 } from "../../packages/vehicle-zmq-observer/src/index.js";
import { viewFixture } from "./view-fixture.js";

describe("project-owned simulation view exact contract and HTTP client", () => {
  it("preserves thirteen predecessor input/output schemas and adds a separate task", () => {
    const before = siteControlV13CatalogContract(),
      after = siteControlV14CatalogContract();
    expect(after.tools).toHaveLength(14);
    for (const old of before.tools) {
      const next = after.tools.find((t) => t.name === old.name);
      expect(next?.inputSchema).toEqual(old.inputSchema);
      expect(next?.outputSchema).toEqual(old.outputSchema);
    }
    const view = present(after.tools.find((t) => t.name === VIEW_TOOL));
    expect(view._meta?.["io.sdar/ugvZmq"]).toMatchObject({
      cameraOwnership: "project_owned",
      eoRecognitionAffected: false,
    });
    expect(() => ViewParameters.parse({ viewId: "view", horizontalFovDeg: 60 })).toThrow();
    expect(() =>
      ViewParameters.parse({
        viewId: "view",
        horizontalFovDeg: null,
        acknowledgeCameraRecreation: true,
      }),
    ).toThrow();
    const camera = present(after.tools.find((t) => t.name === "vehicle_zmq_camera"));
    const validate = new Ajv({ strict: false }).compile(camera.inputSchema);
    expect(
      validate({
        resourceId: "__RESOURCE_ID__",
        operation: {
          name: "camera.simulationView",
          params: { viewId: "view", horizontalFovDeg: 60, acknowledgeCameraRecreation: true },
        },
      }),
    ).toBe(false);
  });
  it("requires actual attributed frames and prevents a revoked operation from reaching apply", async () => {
    const f = await viewFixture(),
      client = new SimulationViewClient(f.settings);
    try {
      const request = {
        protocol: "smpp.simulation-view/1" as const,
        requestId: "client-case",
        resourceId: "vehicle:SIMULATED",
        ownershipId: f.settings.ownershipId,
        expectedApiVersion: f.settings.apiVersion,
        expectedWorldId: "7",
        parentActorId: 1,
        parentRoleName: f.settings.parentRoleName,
        deadlineAt: new Date(Date.now() + 30000).toISOString(),
        parameters: {
          viewId: f.settings.viewId,
          horizontalFovDeg: 60,
          acknowledgeCameraRecreation: true as const,
        },
      };
      const command: WireCommand = {
        stepId: "step",
        generation: 0,
        component: "eo",
        action: "camera",
        requestId: request.requestId,
        method: "SimulationView",
        frames: [Buffer.from(JSON.stringify(request)).toString("base64")],
        status: "intent",
        createdAt: new Date().toISOString(),
        dispatchAt: null,
        completedAt: null,
        response: null,
      };
      const refused = await client.dispatch(command, () => {
        throw Error("ZMQ_OPERATION_REVOKED");
      });
      expect(refused.diagnostic).toMatchObject({ stage: "guard", sendAttempted: false });
      expect(await f.count()).toBe(0);
      const accepted = await client.dispatch(command, () => undefined);
      expect(accepted.outcome).toBe("accepted");
      const reply = await client.query(command),
        hash = sha256(canonical(request));
      expect(reply.status).toBe("applied");
      if (!reply.evidence) throw Error("EXPECTED_FRAME_EVIDENCE");
      expect(() =>
        validateViewReply(
          { ...reply, evidence: { ...reply.evidence, actualHorizontalFovDeg: 90 } },
          request,
          hash,
        ),
      ).toThrow("EVIDENCE_CONFLICT");
      expect(() =>
        validateViewReply(
          { ...reply, evidence: { ...reply.evidence, worldId: "8" } },
          request,
          hash,
        ),
      ).toThrow("EVIDENCE_CONFLICT");
      const badFrame = structuredClone(reply);
      present(badFrame.evidence).frame.frameId = reply.evidence.baselineFrame;
      expect(() => validateViewReply(badFrame, request, hash)).toThrow("EVIDENCE_CONFLICT");
      const badImage = structuredClone(reply);
      present(badImage.evidence).frame.thumbnail.sha256 = "a".repeat(64);
      expect(() => validateViewReply(badImage, request, hash)).toThrow("IMAGE_EVIDENCE_INVALID");
      expect(await f.count()).toBe(1);
    } finally {
      client.close();
      await f.close();
    }
  });
});
