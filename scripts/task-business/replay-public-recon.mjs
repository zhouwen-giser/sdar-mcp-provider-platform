import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  bootstrapTaskBusinessReducer,
  normalizeTaskBusinessSseNotification,
  reduceTaskBusinessFeedback,
  unresolvedTaskBusinessRefs,
} from "../../packages/mcp-protocol/src/index.ts";
const source = process.argv[2];
if (!source || source === "--help") {
  console.log(
    "Usage: node --import tsx scripts/task-business/replay-public-recon.mjs CAPTURE.json [RESULT.json]\nRead-only replay of a full public recon capture; never contacts Runtime, database or device.",
  );
  process.exit(source ? 0 : 2);
}
const bytes = await readFile(source);
const report = JSON.parse(bytes);
assert.equal(report.status, "PUBLIC_RECON_AND_INPUT_PASS");
assert.equal(report.capturePublicPayloads, true, "FULL_PUBLIC_PAYLOAD_CAPTURE_REQUIRED");
assert.equal(report.fireEnabled, false);
assert.deepEqual(
  report.runs.map((run) => run.decision),
  ["continue_observation", "decline"],
);
const evidence = {
  schema: "smpp.recon-public-payload-replay/v1",
  status: "PASS",
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  taskIds: report.runs.map((run) => run.taskId),
  checkedAt: new Date().toISOString(),
  windows: [],
  externalSdarQualified: false,
  scope:
    "Offline replay of actual selected parsed public notifications and full validated Context through SMPP public normalizer/reducer; not external SDAR or byte-level transport replay.",
};
for (const run of report.runs) {
  const window = run.decision;
  const taskId = run.taskId;
  assert.equal(run.runtimeTask.status, "input_required");
  assert.equal(run.locked.input.state, "pending");
  assert.equal(run.locked.action.state, "active");
  assert.equal(run.locked.action.triggerOrigin, "provider_policy");
  const locks = run.journal.filter((entry) => entry.stepId.startsWith("auto-lock:"));
  assert.equal(locks.length, 1, "ONE_JOURNALED_POLICY_LOCK_REQUIRED");
  assert.equal(locks[0].toolName, "ugv_area_recon_lock");
  assert.equal(locks[0].state, "ACCEPTED");
  assert.ok(Date.parse(run.locked.action.startedAt) > Date.parse(locks[0].dispatchedAt));
  assert.equal(run.locked.input.identity.executionId, run.execution.externalExecutionId);
  assert.equal(
    run.locked.action.properties.observationSessionId,
    run.execution.downstreamMissionIds.at(-1),
  );
  assert.ok(run.finalJournal.every((entry) => !/fire|shoot|launch/i.test(entry.toolName)));
  assert.ok(
    ["STRICT_CORRELATED", "INFERRED_CURRENT_EXECUTION"].includes(
      run.locked.action.properties.correlation,
    ),
  );
  assert.equal(run.deviceLock.lock.stage, 3);
  assert.equal(String(run.deviceLock.lock.target_id), run.locked.input.subjectBinding.targetId);
  assert.equal(run.recoveredExecution.state, "RUNNING");
  assert.equal(run.recoveredExecution.controlConfirmation, undefined);
  assert.equal(run.stopped.status, "cancelled");
  assert.equal(run.final.summary.context.summary.status, "finalized");
  if (report.mapFull) {
    assert.ok(run.mapSnapshot, "MAP_FULL_SNAPSHOT_REQUIRED");
    const artifacts = run.mapSnapshot.objects
      .filter((x) => x.kind === "artifact")
      .map((x) => x.value);
    const footprint = artifacts
      .filter((x) => x.artifactType === "recon.current_footprint")
      .sort((a, b) => b.revision - a.revision)[0];
    assert.ok(footprint, "ESTIMATED_FOOTPRINT_REQUIRED");
    assert.equal(footprint.properties.quality, "estimated");
    assert.equal(footprint.availability, "available");
    assert.equal(
      run.mapSnapshot.summary.context.activeRefs.currentFootprint?.id,
      footprint.artifactId,
    );
    assert.equal(
      run.mapSnapshot.summary.context.activeRefs.currentFootprint?.revision,
      footprint.revision,
    );
    assert.equal(footprint.properties.model, "isr.airport.eo-range-sector/v1");
    assert.ok(Date.parse(footprint.validUntil) > Date.parse(footprint.updatedAt));
    assert.equal(footprint.content.geometry.type, "Polygon");
    const ring = footprint.content.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring.at(-1));
    if (window === "decline") {
      const coverage = artifacts
        .filter((x) => x.artifactType === "recon.covered_area")
        .sort((a, b) => b.revision - a.revision)[0];
      assert.ok(coverage, "DEVICE_COVERED_AREA_REQUIRED");
      assert.equal(coverage.availability, "available");
      assert.equal(coverage.source.method, "airport_display_cell_centres");
      assert.equal(coverage.content.geometry.type, "MultiPolygon");
    }
  }
  const answer = report.decisions.find(
    (item) => item.taskId === taskId && item.type === "businessAnswerConfirmed",
  );
  assert.ok(answer, "PUBLIC_ANSWER_CONFIRMATION_REQUIRED");
  assert.equal(answer.taskStatus, "working");
  assert.equal(answer.request.state, window === "decline" ? "declined" : "answered");
  assert.equal(run.deviceAfterDecision.lock.stage, window === "decline" ? 1 : 3);
  if (window === "decline") assert.equal(run.deviceAfterDecision.status, 5);
  else
    assert.equal(
      String(run.deviceAfterDecision.lock.target_id),
      run.locked.input.subjectBinding.targetId,
    );
  let pending,
    state,
    snapshots = 0,
    events = 0,
    duplicateReplays = 0;
  function flush() {
    if (!pending) return;
    const { line, objects } = pending;
    assert.ok(line.context, "FULL_CONTEXT_REQUIRED");
    assert.equal(line.context.identity.taskId, taskId);
    assert.equal(objects.length, line.objectCount);
    state = bootstrapTaskBusinessReducer(
      [
        {
          context: line.context,
          contextRevision: line.contextRevision,
          objects,
          objectDescriptors: [],
        },
      ],
      line.resumeFrom,
    );
    assert.deepEqual(unresolvedTaskBusinessRefs(state), line.unresolvedRefs);
    snapshots++;
    pending = undefined;
  }
  for (const line of report.streams.filter((x) => x.window === window)) {
    if (line.type === "businessObject") {
      assert.ok(pending, "OBJECT_WITHOUT_SNAPSHOT");
      pending.objects.push(line.object);
      continue;
    }
    flush();
    if (line.type === "snapshot") {
      pending = { line, objects: [] };
      continue;
    }
    if (line.type !== "businessEvent") continue;
    assert.ok(state, "EVENT_WITHOUT_SNAPSHOT");
    assert.ok(line.notification, "ORIGINAL_NOTIFICATION_REQUIRED");
    const event = normalizeTaskBusinessSseNotification(line.notification, state.context.identity);
    assert.equal(line.taskId, taskId);
    assert.equal(event.messageId, line.messageId);
    assert.equal(event.kind, line.kind);
    assert.deepEqual(event.resumeFrom, line.publicCursor);
    assert.deepEqual(event.sourceCursor, line.sourceCursor);
    const previous = state;
    state = reduceTaskBusinessFeedback(state, event);
    assert.notEqual(state, previous);
    assert.deepEqual(state.context.phase, line.phase);
    assert.deepEqual(state.context.summary, line.summary);
    assert.deepEqual(state.context.activeRefs, line.activeRefs);
    assert.deepEqual(unresolvedTaskBusinessRefs(state), line.unresolvedRefs);
    assert.equal(reduceTaskBusinessFeedback(state, event), state, "DUPLICATE_EVENT_MUST_BE_NOOP");
    duplicateReplays++;
    events++;
  }
  flush();
  assert.ok(events > 0);
  evidence.windows.push({ window, snapshots, events, duplicateReplays });
}
const snapshots = report.runs.flatMap((run) =>
  [run.locked, run.afterDecision, run.final, ...(run.mapSnapshot ? [run.mapSnapshot] : [])].map(
    (snapshot) => ({ snapshot, taskId: run.taskId }),
  ),
);
for (const { snapshot, taskId } of snapshots) {
  assert.ok(snapshot.summary.context);
  assert.equal(snapshot.summary.context.identity.taskId, taskId);
  const state = bootstrapTaskBusinessReducer(
    [
      {
        context: snapshot.summary.context,
        contextRevision: snapshot.summary.contextRevision,
        objects: snapshot.objects,
        objectDescriptors: [],
      },
    ],
    snapshot.summary.resumeFrom,
  );
  assert.deepEqual(unresolvedTaskBusinessRefs(state), []);
}
assert.equal(report.finalDeviceStatus.status, 9);
assert.equal(report.finalDeviceStatus.lock.stage, 1);
evidence.standaloneSnapshots = snapshots.length;
evidence.completeContexts =
  evidence.windows.reduce((n, w) => n + w.snapshots, 0) + snapshots.length;
evidence.selectedNotifications = evidence.windows.reduce((n, w) => n + w.events, 0);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence));
