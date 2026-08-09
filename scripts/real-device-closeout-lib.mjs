const QUALIFIED_OPERATION_STATUSES = new Set(["real_pass", "real_pass_time_scoped"]);

function isRuntimeTaskCounts(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.active) &&
    value.active >= 0 &&
    Number.isInteger(value.uncertain) &&
    value.uncertain >= 0
  );
}

export function resolveCurrentRuntimeTaskCounts(registryE2e, historicalThreeDevice) {
  const current = registryE2e?.status === "passed" ? registryE2e.runtimeTaskCounts : null;
  if (isRuntimeTaskCounts(current)) {
    return {
      active: current.active,
      uncertain: current.uncertain,
      runtimes: current.runtimes ?? [],
      source: "current_registry_backed_read_only_e2e",
    };
  }

  const historical = historicalThreeDevice?.runtimeTaskCounts;
  if (isRuntimeTaskCounts(historical)) {
    return {
      active: historical.active,
      uncertain: historical.uncertain,
      runtimes: historical.runtimes ?? [],
      source: "historical_qualified_three_device_run",
    };
  }

  return { active: null, uncertain: null, runtimes: [], source: "unavailable" };
}

export function hasStateChangedSubscription(preflight) {
  const websocket = preflight?.websocket ?? preflight?.ws;
  return websocket?.subscribedEventType === "state_changed";
}

export function buildSdarIntegrationAllowlist({
  environment,
  providerEndpoints,
  resourceBindings,
  preflightResources,
  operationQualifications,
  functionalPass,
  resiliencePass,
  fullCapabilityPass,
  blockers,
}) {
  const currentResources = new Map(
    (preflightResources ?? []).map((resource) => [resource.resourceId, resource]),
  );
  const resourceStatus = resourceBindings.map((binding) => {
    const current = currentResources.get(binding.resourceId);
    const available =
      current?.reachable === true && current.state !== "unknown" && current.state !== "unavailable";
    return {
      ...binding,
      available,
      reason: available ? null : current ? `home_assistant_${current.state}` : "preflight_missing",
    };
  });
  const operationStatus = Object.entries(operationQualifications).map(
    ([operation, qualification]) => ({
      providerId: operation.startsWith("climate_") ? "ha-climate-lab" : "ha-light-lab",
      operation,
      qualification,
      qualified: QUALIFIED_OPERATION_STATUSES.has(qualification),
    }),
  );
  const overallReady = functionalPass && resiliencePass && fullCapabilityPass;
  const functionalOperations = operationStatus.filter((item) => item.qualified);

  return {
    evidenceClass: "mixed",
    environment,
    status: overallReady ? "allow" : functionalPass ? "functional_only" : "blocked",
    activationAllowed: overallReady,
    providers: providerEndpoints.map((provider) => ({
      providerId: provider.providerId,
      serverId: provider.serverId,
      protocolMode: provider.protocolMode,
      effectiveEndpoint: provider.effectiveEndpoint,
      catalogRevision: provider.catalogRevision,
      allowedResources: functionalPass
        ? resourceStatus
            .filter((item) => item.providerId === provider.providerId && item.available)
            .map((item) => item.resourceId)
        : [],
      forbiddenResources: resourceStatus
        .filter((item) => item.providerId === provider.providerId && !item.available)
        .map((item) => ({ resourceId: item.resourceId, reason: item.reason })),
      allowedOperations: functionalPass
        ? functionalOperations
            .filter((item) => item.providerId === provider.providerId)
            .map((item) => item.operation)
        : [],
      forbiddenOperations: operationStatus
        .filter((item) => item.providerId === provider.providerId && !item.qualified)
        .map((item) => ({ operation: item.operation, reason: item.qualification })),
    })),
    allowedProviders: functionalPass
      ? providerEndpoints.map((provider) => provider.providerId)
      : [],
    allowedResources: functionalPass
      ? resourceStatus.filter((item) => item.available).map((item) => item.resourceId)
      : [],
    allowedOperations: functionalPass
      ? functionalOperations.map(({ providerId, operation, qualification }) => ({
          providerId,
          operation,
          qualification,
        }))
      : [],
    forbiddenOrUnverifiedResources: resourceStatus
      .filter((item) => !item.available)
      .map(({ providerId, resourceId, reason }) => ({ providerId, resourceId, reason })),
    forbiddenOrUnverifiedOperations: operationStatus
      .filter((item) => !item.qualified)
      .map(({ providerId, operation, qualification }) => ({
        providerId,
        operation,
        reason: qualification,
      })),
    candidateFunctionalScope: {
      resources: resourceStatus.filter((item) => item.available).map((item) => item.resourceId),
      operations: functionalOperations.map(({ providerId, operation, qualification }) => ({
        providerId,
        operation,
        qualification,
      })),
    },
    readiness: {
      functional: functionalPass,
      resilience: resiliencePass,
      fullCapability: fullCapabilityPass,
      readyForSdarIntegration: overallReady,
    },
    externalResourceBlockers: resourceStatus
      .filter((item) => !item.available)
      .map(({ resourceId, reason }) => ({ resourceId, reason })),
    blockers,
    noSecrets: true,
    noEntityIds: true,
  };
}

export function describeCurrentPreflight(preflight) {
  if (preflight.status === "passed") {
    return "The latest read-only Home Assistant preflight passed for all configured resources.";
  }
  const unavailable = (preflight.resources ?? [])
    .filter(
      (resource) =>
        resource.reachable !== true ||
        resource.state === "unknown" ||
        resource.state === "unavailable",
    )
    .map((resource) => `${resource.resourceId} (${resource.state ?? "missing"})`);
  return unavailable.length > 0
    ? `The latest read-only Home Assistant preflight failed for: ${unavailable.join(", ")}. No device writes were attempted.`
    : "The latest read-only Home Assistant preflight failed. No device writes were attempted.";
}

export function renderFaultMatrix(qualification, currentPreflightStatus) {
  const preflightText =
    currentPreflightStatus === "passed"
      ? "passed for three configured resources"
      : `blocked (${currentPreflightStatus})`;
  return [
    "# SMPP real-device fault matrix",
    "",
    "| Area | Evidence | Status |",
    "| --- | --- | --- |",
    `| Home Assistant preflight | real | ${preflightText} |`,
    "| Climate Provider | real | passed for executed mode/temperature/power-off scope |",
    "| Light Provider | real | passed for both configured lights |",
    "| Runtime idempotency | real/contract | passed for bounded duplicate and conflict scenarios |",
    `| Adapter in-flight restart | mixed | ${qualification.resilience.adapterInFlight} |`,
    `| Runtime in-flight restart | mixed | ${qualification.resilience.runtimeInFlight} |`,
    `| Real fault injection | mixed | ${qualification.resilience.realFaultInjection} |`,
    `| PMS outage Task Authority | unverified | ${qualification.resilience.pmsOutageTaskAuthority} |`,
    "| Manual AC safety interval | real | preserved; no unsafe inverse operation forced |",
    "",
    "Controlled fault-injection results remain classified as controlled evidence and are not promoted to real-device qualification.",
    "",
  ].join("\n");
}
