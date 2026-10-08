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
    "Usage: node --import tsx scripts/task-business/replay-public-navigation.mjs CAPTURE.json [RESULT.json]\nRead-only replay of a full public navigation capture; never contacts Runtime, database or device.",
  );
  process.exit(source ? 0 : 2);
}
const bytes = await readFile(source);
const report = JSON.parse(bytes);
assert.equal(report.status, "PUBLIC_NAVIGATION_AND_PROCESS_RESTART_PASS");
assert.equal(report.capturePublicPayloads, true, "FULL_PUBLIC_PAYLOAD_CAPTURE_REQUIRED");
assert.equal(report.fireEnabled, false);
assert.equal(report.task.taskId, report.taskId);
assert.equal(report.task.status, "completed");
const evidence = {
  schema: "smpp.navigation-public-payload-replay/v1",
  status: "PASS",
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  taskId: report.taskId,
  checkedAt: new Date().toISOString(),
  windows: [],
  externalSdarQualified: false,
  scope:
    "Offline replay of actual selected parsed public notifications and full validated Context through SMPP public normalizer/reducer; not external SDAR or byte-level transport replay.",
};
for (const window of ["initial", "recovered"]) {
  let pending,
    state,
    snapshots = 0,
    events = 0,
    duplicateReplays = 0;
  function flush() {
    if (!pending) return;
    const { line, objects } = pending;
    assert.ok(line.context, "FULL_CONTEXT_REQUIRED");
    assert.equal(line.context.identity.taskId, report.taskId);
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
    assert.equal(line.taskId, report.taskId);
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
const snapshots = report.reads.concat(report.finalSnapshot);
for (const snapshot of snapshots) {
  assert.ok(snapshot.summary.context);
  assert.equal(snapshot.summary.context.identity.taskId, report.taskId);
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
assert.equal(report.finalSnapshot.summary.context.summary.status, "finalized");
evidence.standaloneSnapshots = snapshots.length;
evidence.completeContexts =
  evidence.windows.reduce((n, w) => n + w.snapshots, 0) + snapshots.length;
evidence.selectedNotifications = evidence.windows.reduce((n, w) => n + w.events, 0);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence));
