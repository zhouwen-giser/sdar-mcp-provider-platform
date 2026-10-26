import { Ajv2020 } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import addFormatsImport from "ajv-formats";
import {
  array,
  record,
  text,
  taskProfile,
  CONTROL_TOOLS,
  READ_TOOLS,
  type Json,
  type Tool,
  type Command,
} from "../shared/model.js";
import { validatePolygon } from "../shared/coordinates.js";
import {
  ZMQ_INSPECT,
  isZmqControl,
  EFFECT_APPLY,
  INSPECTION_RESULT,
  EFFECT_RESULT,
  zmqToolReason,
  nativeCatalogReason,
  PLAN_ROUTE,
  siteReadonlyTools,
  validateZmqGeometry,
} from "../shared/zmq.js";
import { businessSnapshot, readArtifact } from "./business.js";
import type { Mcp } from "./mcp.js";
import { toolContent, UpstreamError } from "./mcp.js";
import type { Store } from "./store.js";
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
const addFormats = addFormatsImport as unknown as (instance: Ajv2020) => void;
addFormats(ajv);
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(record(value))
            .sort()
            .map((key) => [key, sorted(record(value)[key])]),
        )
      : value;
const wireHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sorted(value)))
    .digest("hex");
export function validateSchema(schema: Json, value: unknown) {
  const validate = ajv.compile(schema);
  if (!validate(value)) throw Error("TOOL_ARGUMENTS_SCHEMA_MISMATCH");
}
export class Service {
  #stateCache?: { value: Json; expires: number };
  #stateFlight?: Promise<Json>;
  constructor(
    readonly mcp: Mcp,
    readonly store: Store,
    readonly actor: string,
  ) {}
  async catalog() {
    const [discovery, list] = await Promise.all([
      this.mcp.rpc("server/discover"),
      this.mcp.rpc("tools/list"),
    ]);
    const extensions = record(record(discovery.capabilities).extensions),
      provider = record(extensions["io.sdar/providerCatalog"]);
    if (!array(discovery.supportedVersions).includes("2026-07-28") || !provider.manifestHash)
      throw Error("MCP_CONTRACT_MISMATCH");
    const tools = array(list.tools).map((v) => record(v) as unknown as Tool);
    const state = tools.find((t) => t.name === "vehicle_get_state");
    const resourceId = text(record(record(state?.inputSchema.properties).resourceId).const);
    if (!resourceId) throw Error("UGV_RESOURCE_BINDING_UNRESOLVED");
    if (provider.providerType === "isr.vehicle.ugv.zmq") {
      const reason = nativeCatalogReason(tools, resourceId);
      if (reason) throw Error(reason);
    }
    return {
      provider,
      extensions,
      tools,
      resourceId,
      catalogHash: text(provider.manifestHash),
      checkedAt: new Date().toISOString(),
    };
  }
  state(): Promise<Json> {
    if (this.#stateCache && this.#stateCache.expires > Date.now())
      return Promise.resolve(this.#stateCache.value);
    if (this.#stateFlight) return this.#stateFlight;
    this.#stateFlight = this.#readState()
      .then((value) => {
        this.#stateCache = { value, expires: Date.now() + 1000 };
        return value;
      })
      .finally(() => {
        this.#stateFlight = undefined;
      });
    return this.#stateFlight;
  }
  async #readState() {
    const c = await this.catalog();
    const names = [
      "vehicle_get_state",
      "vehicle_get_capabilities",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
    ];
    const data: Json = {};
    const errors: Json = {};
    await Promise.all(
      names.map(async (name) => {
        try {
          if (!c.tools.some((t) => t.name === name)) throw Error("TOOL_UNPUBLISHED");
          data[name] = toolContent(
            await this.mcp.tool(name, {
              resourceId: c.resourceId,
              ...(name === "vehicle_get_state"
                ? { include: ["chassis", "payload", "health", "targets"] }
                : {}),
            }),
          );
        } catch (e) {
          errors[name] = safeCode(e);
        }
      }),
    );
    return { ...c, data, errors, receivedAt: new Date().toISOString() };
  }
  validateTool(c: Awaited<ReturnType<Service["catalog"]>>, name: string, args: Json) {
    const tool = c.tools.find((t) => t.name === name);
    if (!tool) throw Error("TOOL_UNPUBLISHED");
    if (![...CONTROL_TOOLS, ...READ_TOOLS].includes(name as (typeof CONTROL_TOOLS)[number]))
      throw Error("TOOL_NOT_SUPPORTED_BY_CONSOLE");
    if (args.resourceId !== c.resourceId) throw Error("UGV_RESOURCE_BINDING_MISMATCH");
    const reason = zmqToolReason(tool, c.resourceId);
    if (reason) throw Error(reason);
    if (
      (isZmqControl(name) || [INSPECTION_RESULT, EFFECT_RESULT].includes(name)) &&
      !siteReadonlyTools(c.tools) &&
      (this.mcp.headers["x-sdar-execution-mode"] !== "simulation" ||
        !this.mcp.headers["x-sdar-simulation-id"])
    )
      throw Error("ZMQ_SIMULATION_DOMAIN_REQUIRED");
    validateSchema(tool.inputSchema, args);
    if (name === ZMQ_INSPECT || name === "vehicle_zmq_area_recon") validateZmqGeometry(args);
    const isControl = (CONTROL_TOOLS as readonly string[]).includes(name);
    if (
      isControl &&
      (taskProfile(tool).profileVersion !== "1.0" ||
        taskProfile(tool).taskBehavior !== "task_required" ||
        taskProfile(tool).idempotency !== "server_managed")
    )
      throw Error("MCP_TASK_PROFILE_MISMATCH");
    if (name === "vehicle_area_recon" && args.scanMode === "area")
      validatePolygon(
        array(record(args.area).polygon).map((v) => {
          const p = record(v);
          return { longitude: Number(p.longitude), latitude: Number(p.latitude) };
        }),
      );
    if (name === "vehicle_inspect_area") {
      validatePolygon(
        array(record(args.area).boundary).map((v) => {
          const p = record(v);
          return { longitude: Number(p.x), latitude: Number(p.y) };
        }),
      );
      if (array(record(args.area).excludedZones).length)
        throw Error("INSPECTION_EXCLUDED_ZONES_UNRESOLVED");
    }
    return tool;
  }
  async availability(
    toolName: string,
    args: Json,
    timing?: Command["timing"],
  ): Promise<Json & { catalogHash: string }> {
    const catalog = await this.catalog();
    this.validateTool(catalog, toolName, args);
    if (
      isZmqControl(toolName) &&
      (!timing ||
        timing.maxElapsedMs < 1000 ||
        timing.maxElapsedMs > 300000 ||
        timing.start.startToleranceMs > 60000)
    )
      throw Error("ZMQ_TIMING_CONTRACT_MISMATCH");
    const result = await this.mcp.rpc("io.sdar/taskExecution/checkAvailability", {
      profileVersion: "1.0",
      checks: [
        {
          requestId: "console-preflight",
          operationName: toolName,
          arguments: { state: "complete", value: args },
          ...(timing ? { timing } : {}),
        },
      ],
    });
    const check = record(array(result.results)[0]);
    if (check.operationName !== toolName || !Number.isFinite(Date.parse(text(check.validUntil))))
      throw Error("MCP_AVAILABILITY_INVALID");
    return { ...check, catalogHash: catalog.catalogHash };
  }
  async readTool(name: string, args: Json) {
    if (name === PLAN_ROUTE) throw Error("USE_COMMAND_PREVIEW_ROUTE");
    if ([INSPECTION_RESULT, EFFECT_RESULT].includes(name))
      throw Error("USE_IMPORTED_TASK_RESULT_ROUTE");
    const c = await this.catalog();
    if (!(READ_TOOLS as readonly string[]).includes(name)) throw Error("READ_TOOL_REQUIRED");
    this.validateTool(c, name, args);
    return toolContent(await this.mcp.tool(name, args));
  }
  async task(taskId: string) {
    const saved = await this.store.task(taskId);
    if (!saved) throw Error("TASK_NOT_IMPORTED");
    const snapshot = await this.mcp.rpc("tasks/get", { taskId });
    if (snapshot.taskId !== taskId) throw Error("TASK_IDENTITY_MISMATCH");
    const operation =
      text(record(record(snapshot._meta)["io.sdar/taskExecution"]).operationName) ||
      saved.operation;
    await this.store.saveTask(taskId, operation, snapshot);
    return snapshot;
  }
  async importTask(taskId: string) {
    const snapshot = await this.mcp.rpc("tasks/get", { taskId });
    if (snapshot.taskId !== taskId) throw Error("TASK_IDENTITY_MISMATCH");
    const meta = record(record(snapshot._meta)["io.sdar/taskExecution"]);
    let operation = text(meta.operationName);
    if (!operation) {
      try {
        operation = text(
          record((await businessSnapshot(this.mcp, taskId)).context.identity).operationName,
        );
      } catch {
        /* The Task remains readable without a business profile. */
      }
    }
    if (operation && !(CONTROL_TOOLS as readonly string[]).includes(operation))
      throw Error("TASK_OPERATION_NOT_SUPPORTED");
    await this.store.saveTask(taskId, operation, snapshot);
    await this.store.audit(this.actor, "task.import");
    return snapshot;
  }
  async business(taskId: string) {
    if (!(await this.store.task(taskId))) throw Error("TASK_NOT_IMPORTED");
    const snapshot = await businessSnapshot(this.mcp, taskId),
      catalog = await this.catalog();
    const identity = record(snapshot.context.identity);
    if (
      identity.resourceId !== catalog.resourceId ||
      identity.providerId !== catalog.provider.providerId
    )
      throw Error("TASK_RESOURCE_BINDING_MISMATCH");
    return snapshot;
  }
  async artifact(taskId: string, id: string, revision: number) {
    const business = await this.business(taskId);
    return readArtifact(this.mcp, taskId, id, revision, record(business.context.identity));
  }
  async supplement(taskId: string, afterRevision = 0): Promise<Json> {
    const saved = await this.store.task(taskId);
    if (!saved) throw Error("TASK_NOT_IMPORTED");
    const name =
      saved.operation === EFFECT_APPLY
        ? EFFECT_RESULT
        : saved.operation === ZMQ_INSPECT
          ? INSPECTION_RESULT
          : "";
    if (!name) throw Error("TASK_RESULT_QUERY_UNSUPPORTED");
    const b = await this.business(taskId),
      identity = record(b.context.identity),
      catalog = await this.catalog();
    if (
      identity.taskId !== taskId ||
      !text(identity.executionId) ||
      identity.simulationId !== this.mcp.headers["x-sdar-simulation-id"]
    )
      throw Error("TASK_IDENTITY_UNCONFIRMED");
    const args = {
      resourceId: catalog.resourceId,
      taskId,
      executionId: text(identity.executionId),
      afterRevision,
      limit: 8,
    };
    this.validateTool(catalog, name, args);
    const result = toolContent(await this.mcp.tool(name, args)),
      page = record(result.page),
      resultIdentity = record(page.identity),
      rows = array(page.records).map(record);
    if (
      result.schemaVersion !==
        (name === EFFECT_RESULT ? "ugv.zmq-effect-query/1" : "ugv.zmq-inspection-result/1") ||
      page.schemaVersion !== "ugv.zmq-result-page/1" ||
      page.historySource !== "platform_retained_only" ||
      resultIdentity.taskId !== taskId ||
      resultIdentity.externalExecutionId !== identity.executionId ||
      resultIdentity.resourceId !== catalog.resourceId ||
      resultIdentity.providerId !== catalog.provider.providerId ||
      resultIdentity.executionMode !== "simulation" ||
      resultIdentity.simulationId !== this.mcp.headers["x-sdar-simulation-id"] ||
      rows.length > 8 ||
      typeof page.hasMore !== "boolean"
    )
      throw Error("TASK_RESULT_IDENTITY_MISMATCH");
    let previous = afterRevision;
    for (const row of rows) {
      const { schemaVersion, revision, contentHash, ...draft } = row;
      if (
        schemaVersion !== "ugv.zmq-result-record/1" ||
        typeof revision !== "number" ||
        !Number.isSafeInteger(revision) ||
        revision <= previous ||
        wireHash(row.identity) !== wireHash(resultIdentity) ||
        contentHash !== wireHash(draft)
      )
        throw Error("TASK_RESULT_INTEGRITY_FAILED");
      previous = revision;
    }
    if (page.nextRevision !== previous || (page.hasMore && !rows.length))
      throw Error("TASK_RESULT_CURSOR_INVALID");
    return result;
  }
  async exportSupplement(taskId: string) {
    const pages: Json[] = [];
    let after = 0,
      bytes = 0;
    for (let count = 0; count < 512; count++) {
      const value = await this.supplement(taskId, after),
        page = record(value.page);
      bytes += Buffer.byteLength(JSON.stringify(value));
      if (bytes > 24 * 1024 * 1024) throw Error("TASK_RESULT_EXPORT_LIMIT_USE_PAGES");
      pages.push(value);
      if (page.hasMore !== true) return { historySource: "platform_retained_only", pages };
      after = Number(page.nextRevision);
    }
    throw Error("TASK_RESULT_EXPORT_LIMIT_USE_PAGES");
  }
  async execute(request: Command) {
    const reserved = await this.store.reserve(request);
    if (!reserved.fresh) return reserved.row;
    await this.store.audit(this.actor, "command.created", request.commandId);
    let sent = false;
    try {
      if (
        request.kind === "tool"
          ? request.taskId !== undefined
          : request.tool !== undefined || request.timing !== undefined
      )
        throw Error("COMMAND_SHAPE_INVALID");
      const catalog = await this.catalog();
      if (catalog.catalogHash !== request.catalogHash)
        throw Error("CATALOG_CHANGED_REFRESH_REQUIRED");
      if (
        siteReadonlyTools(catalog.tools) &&
        (request.kind !== "tool" ||
          (CONTROL_TOOLS as readonly string[]).includes(request.tool ?? ""))
      )
        throw Error("ZMQ_SITE_READONLY_CONTROL_DISABLED");
      let method: string, params: Json;
      if (request.kind === "tool") {
        const name = request.tool ?? "";
        if (!(CONTROL_TOOLS as readonly string[]).includes(name) && name !== PLAN_ROUTE)
          throw Error("CONTROL_TOOL_REQUIRED");
        const tool = this.validateTool(catalog, name, request.arguments);
        if (
          request.timing?.start.mode === "scheduled" &&
          taskProfile(tool).supportsScheduling !== true
        )
          throw Error("SCHEDULING_NOT_SUPPORTED");
        if (request.timing && taskProfile(tool).supportsMaxElapsed !== true)
          throw Error("EXECUTION_BUDGET_NOT_SUPPORTED");
        if (
          name === "vehicle_inspect_area" &&
          (!request.timing || request.timing.maxElapsedMs > 300000)
        )
          throw Error("INSPECTION_MAX_ELAPSED_EXCEEDED");
        if (name !== "vehicle_emergency_stop") {
          const available = await this.availability(name, request.arguments, request.timing);
          if (available.catalogHash !== catalog.catalogHash)
            throw Error("CATALOG_CHANGED_REFRESH_REQUIRED");
          if (
            available.availability !== "available" ||
            Date.parse(text(available.validUntil)) <= Date.now()
          ) {
            const response = { outcome: "admission_rejected", ...available };
            await this.store.audit(
              this.actor,
              "command.rejected",
              request.commandId,
              text(available.reasonCode),
            );
            return await this.store.finish(request.commandId, "rejected", response);
          }
        }
        method = "tools/call";
        params = {
          name,
          arguments: request.arguments,
          _meta: {
            "io.sdar/taskExecution": {
              profileVersion: "1.0",
              idempotencyKey: request.commandId,
              ...(request.timing ? { timing: request.timing } : {}),
            },
          },
        };
      } else {
        const taskId = request.taskId ?? "";
        const task = await this.task(taskId);
        const saved = await this.store.task(taskId);
        const operation = saved?.operation ?? "";
        const tool = catalog.tools.find((t) => t.name === operation);
        if (!(CONTROL_TOOLS as readonly string[]).includes(operation))
          throw Error("TASK_OPERATION_NOT_SUPPORTED");
        if (!["working", "input_required"].includes(text(task.status)))
          throw Error("TASK_ALREADY_TERMINAL");
        if (["pause", "resume", "cancel"].includes(request.kind)) {
          if (
            request.kind === "cancel"
              ? taskProfile(tool).supportsCancellation !== true
              : taskProfile(tool).supportsPauseResume !== true
          )
            throw Error("TASK_CONTROL_NOT_SUPPORTED");
          if (Object.keys(request.arguments).length) throw Error("TASK_CONTROL_ARGUMENTS_INVALID");
          method =
            request.kind === "cancel"
              ? "tasks/cancel"
              : `io.sdar/taskExecution/tasks/${request.kind}`;
          params = { taskId };
        } else if (request.kind === "input") {
          const args = request.arguments,
            keys = Object.keys(args);
          if (
            keys.some((k) => !["requestKey", "requestRevision", "action"].includes(k)) ||
            !["accept", "decline", "cancel"].includes(text(args.action))
          )
            throw Error("INPUT_RESPONSE_INVALID");
          const business = await this.business(taskId);
          if (!business.complete) throw Error("BUSINESS_SNAPSHOT_INCOMPLETE");
          const current = business.objects
            .map((o) => record(o.value))
            .find(
              (o) =>
                o.requestKey === args.requestKey &&
                o.revision === args.requestRevision &&
                o.state === "pending" &&
                o.inputType === "target.disposition_decision",
            );
          if (
            !current ||
            !record(task.inputRequests)[text(args.requestKey)] ||
            (current.deadlineAt && Date.parse(text(current.deadlineAt)) <= Date.now())
          )
            throw Error("BUSINESS_INPUT_REQUEST_SUPERSEDED");
          if (args.action === "accept")
            validateSchema(record(current.inputSchema), { decision: "continue_observation" });
          method = "tasks/update";
          params = {
            taskId,
            inputResponses: {
              [text(args.requestKey)]: {
                action: args.action,
                ...(args.action === "accept"
                  ? { content: { decision: "continue_observation" } }
                  : {}),
              },
            },
          };
        } else {
          const business = await this.business(taskId),
            args = request.arguments;
          if (!business.complete) throw Error("BUSINESS_SNAPSHOT_INCOMPLETE");
          if (
            Object.keys(args).some(
              (k) =>
                ![
                  "interventionId",
                  "interventionRevision",
                  "effectivePlanRevision",
                  "input",
                ].includes(k),
            )
          )
            throw Error("INTERVENTION_ARGUMENTS_INVALID");
          const current = business.objects
            .map((o) => record(o.value))
            .find(
              (o) =>
                o.interventionId === args.interventionId &&
                o.revision === args.interventionRevision &&
                o.state === "available" &&
                o.interventionType === "navigation.adjust_plan",
            );
          if (
            !current ||
            business.context.effectivePlanRevision !== args.effectivePlanRevision ||
            (current.validUntil && Date.parse(text(current.validUntil)) <= Date.now())
          )
            throw Error("PLAN_REVISION_CONFLICT");
          validateSchema(record(current.inputSchema), args.input);
          method = "io.sdar/taskBusiness/interventions/apply";
          params = {
            schemaVersion: "sdar.runtime-intervention-command/1.0-rc2",
            commandId: request.commandId,
            taskId,
            executionId: record(business.context.identity).executionId,
            interventionId: args.interventionId,
            guard: {
              mode: "semantic",
              expectedInterventionRevision: current.revision,
              expectedEffectivePlanRevision: business.context.effectivePlanRevision,
            },
            input: args.input,
          };
        }
      }
      sent = true;
      const result = await this.mcp.rpc(method, params, 20000);
      const taskId = typeof result.taskId === "string" ? result.taskId : request.taskId;
      const rejected = result.isError === true;
      const finished = await this.store.finish(
        request.commandId,
        rejected ? "rejected" : request.tool === PLAN_ROUTE ? "completed" : "accepted",
        result,
        taskId,
      );
      if (taskId) {
        await this.store.saveTask(
          taskId,
          request.tool ?? (await this.store.task(taskId))?.operation ?? "",
          result.resultType === "task" ? result : ((await this.store.task(taskId))?.snapshot ?? {}),
        );
      }
      await this.store.audit(
        this.actor,
        rejected ? "command.rejected" : "command.accepted",
        request.commandId,
      );
      return finished;
    } catch (e) {
      const uncertain = sent && (!(e instanceof UpstreamError) || e.uncertain);
      await this.store.audit(
        this.actor,
        uncertain ? "command.unknown" : "command.rejected",
        request.commandId,
        safeCode(e),
      );
      return this.store.finish(request.commandId, uncertain ? "unknown" : "rejected", {
        reasonCode: safeCode(e),
        outcome: uncertain ? "unconfirmed" : "rejected",
      });
    }
  }
}
export function safeCode(error: unknown): string {
  const code =
    error instanceof UpstreamError ? error.code : error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:-]{2,120}$/.test(code) ? code : "CONSOLE_OPERATION_FAILED";
}
