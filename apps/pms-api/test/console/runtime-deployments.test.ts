import { describe, expect, it } from "vitest";
import { createConsoleTestApp, WRITE_HEADERS } from "./helpers.js";

describe("Console RuntimeDeployment operations", () => {
  it("returns 202 intents and preserves desiredState=stopped", async () => {
    const { app, spies } = createConsoleTestApp();
    const stopped = await app.inject({
      method: "POST",
      url: "/api/console/v1/runtime-deployments/deployment-1/stop",
      headers: WRITE_HEADERS,
      payload: { providerId: "provider-1", expectedDesiredRevision: 1 },
    });
    expect(stopped.statusCode).toBe(202);
    expect(stopped.json()).toMatchObject({
      operationId: "corr-1",
      deployment: { desiredState: "stopped", desiredReplicas: 0 },
    });
    expect(spies.commandDeployment).toHaveBeenCalledWith(
      {
        providerId: "provider-1",
        deploymentId: "deployment-1",
        command: "stop",
        expectedDesiredRevision: 1,
      },
      { actorId: "prototype-user", correlationId: "corr-1" },
    );
    await app.close();
  });
});

