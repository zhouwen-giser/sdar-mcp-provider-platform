export type ProbeRecord = Record<string, unknown>;

export function isProbeRecord(value: unknown): value is ProbeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Scene authorization is carried by the Runtime request, even when optional
 * public business identity fields are omitted by the producer. */
export function simulationProbeFetch(
  fetchImpl: typeof fetch,
  sceneInstanceId: string,
): typeof fetch {
  return (url, init) => {
    const headers = new Headers(init?.headers);
    for (const [key, value] of [
      ["x-sdar-execution-mode", "simulation"],
      ["x-sdar-simulation-id", sceneInstanceId],
    ] as const) {
      const existing = headers.get(key);
      if (existing !== null && existing !== value)
        throw new Error("PROBE_SIMULATION_CONTEXT_MISMATCH");
      headers.set(key, value);
    }
    return fetchImpl(url, { ...init, headers });
  };
}

/** Shared authenticated transport for the explicit, single-Task write probes. */
export function createWriteProbeClient(options: {
  mcpUrl: string;
  taskId: string;
  bearerToken: string;
  clientName: string;
  errorPrefix: string;
  fetchImpl?: typeof fetch;
}): (method: string, params: ProbeRecord) => Promise<ProbeRecord> {
  const url = new URL(options.mcpUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error(`${options.errorPrefix}_URL_INVALID`);
  if (!options.bearerToken.trim()) throw new Error(`${options.errorPrefix}_BEARER_REQUIRED`);
  const fetchImpl = options.fetchImpl ?? fetch;
  let serial = 0;
  return async (method, params) => {
    const id = `${options.clientName}-${++serial}`;
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        "mcp-name": options.taskId,
        authorization: `Bearer ${options.bearerToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: options.clientName, version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: {
                "io.modelcontextprotocol/tasks": {},
                "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const envelope: unknown = await response.json();
    if (
      !response.ok ||
      !isProbeRecord(envelope) ||
      envelope.jsonrpc !== "2.0" ||
      envelope.id !== id ||
      envelope.error !== undefined ||
      !isProbeRecord(envelope.result)
    ) {
      const reason =
        isProbeRecord(envelope) &&
        isProbeRecord(envelope.error) &&
        isProbeRecord(envelope.error.data)
          ? envelope.error.data.reasonCode
          : undefined;
      throw new Error(
        `${options.errorPrefix}_RPC_FAILED:${typeof reason === "string" && /^[A-Z0-9_]{1,128}$/.test(reason) ? reason : response.status}`,
      );
    }
    return envelope.result;
  };
}
