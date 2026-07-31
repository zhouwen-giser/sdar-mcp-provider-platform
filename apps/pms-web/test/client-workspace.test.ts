import { describe, expect, it, vi } from "vitest";
import { ClientWorkspaceStore } from "../src/client-workspace/store.js";

describe("client-only workspaces", () => {
  it("keeps notifications, incidents and changes outside contract gateways", () => {
    const store = new ClientWorkspaceStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.markAllNotifications();
    const incident = store.createIncident({ title: "Local incident", severity: "SEV-3", deploymentId: "deploy-001", owner: "reviewer" });
    store.addIncidentNote(incident.incidentId, "Local note");
    store.closeIncident(incident.incidentId);
    const change = store.createChange({ title: "Local review", kind: "runtime", subjectId: "deploy-001", impact: "No backend persistence" });
    store.reviewChange(change.changeId, true);
    expect(store.snapshot().notifications.every(item => item.read)).toBe(true);
    expect(store.snapshot().incidents.find(item => item.incidentId === incident.incidentId)?.status).toBe("CLOSED");
    expect(store.snapshot().changes.find(item => item.changeId === change.changeId)?.status).toBe("APPROVED");
    expect(listener).toHaveBeenCalled();
  });

  it("projects accepted intents into deterministic operations and jobs", () => {
    const store = new ClientWorkspaceStore();
    store.recordIntent("runtime.reconcile", "deploy-001", "corr-local-test");
    const operation = store.snapshot().operations[0];
    expect(operation?.status).toBe("ACCEPTED");
    store.advanceOperation(operation?.operationId ?? "");
    expect(store.snapshot().operations[0]?.status).toBe("RUNNING");
    store.advanceOperation(operation?.operationId ?? "");
    expect(store.snapshot().operations[0]?.status).toBe("SUCCEEDED");
    expect(store.snapshot().jobs[0]?.status).toBe("SUCCEEDED");
  });
});
