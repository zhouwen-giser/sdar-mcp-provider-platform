export function normalizeVehicleDeviceTargets(
  values: readonly unknown[],
  errorPrefix: "UGV" | "NPC_TANK",
  fallbackObservedAt = new Date().toISOString(),
): Record<string, unknown>[] {
  return values.map((value) => normalizeTarget(value, errorPrefix, fallbackObservedAt));
}

export function deduplicateNormalizedVehicleTargets(
  ...groups: readonly (readonly Record<string, unknown>[])[]
): Record<string, unknown>[] {
  const selected = new Map<string, Record<string, unknown>>();
  for (const target of groups.flat()) {
    const targetId = scalarText(target.targetId ?? target.target_id);
    if (targetId === undefined) continue;
    const normalized = { ...target, targetId };
    const previous = selected.get(targetId);
    if (previous === undefined || prefer(normalized, previous)) selected.set(targetId, normalized);
  }
  return [...selected.values()].sort((left, right) =>
    String(left.targetId).localeCompare(String(right.targetId), "en", { numeric: true }),
  );
}

function normalizeTarget(
  value: unknown,
  errorPrefix: "UGV" | "NPC_TANK",
  fallbackObservedAt: string,
): Record<string, unknown> {
  if (!record(value)) throw new Error(`${errorPrefix}_DEVICE_TARGET_INVALID`);
  const targetId = scalarText(value.target_id ?? value.targetId ?? value.id);
  if (targetId === undefined) throw new Error(`${errorPrefix}_DEVICE_TARGET_ID_INVALID`);
  const observedAt =
    captureTime(value.capture_time_us) ?? scalarText(value.observedAt) ?? fallbackObservedAt;
  const position = record(value.position)
    ? compact({
        longitude: finite(value.position.longitude),
        latitude: finite(value.position.latitude),
        altitude: finite(value.position.altitude),
      })
    : undefined;
  const velocity = record(value.velocity)
    ? compact({
        eastMps: finite(value.velocity.vel_e),
        northMps: finite(value.velocity.vel_n),
        upMps: finite(value.velocity.vel_u),
      })
    : undefined;
  const pixel = record(value.pixel_pos)
    ? compact({
        x: finite(value.pixel_pos.x),
        y: finite(value.pixel_pos.y),
        theta: finite(value.pixel_pos.theta),
        width: finite(value.pixel_pos.w),
        height: finite(value.pixel_pos.h),
      })
    : undefined;
  return compact({
    targetId,
    targetType: finite(value.type),
    objectType: scalarText(value.objectType ?? value.object_type),
    position: position === undefined || Object.keys(position).length === 0 ? undefined : position,
    coordinateFrame: position === undefined ? value.coordinateFrame : "WGS84",
    velocity: velocity === undefined || Object.keys(velocity).length === 0 ? undefined : velocity,
    distanceM: finite(value.distance ?? value.distanceM),
    confidence: finite(value.confidence),
    threat: finite(value.threat),
    iff: finite(value.iff),
    lockTimeSec: finite(value.lock_time ?? value.lockTimeSec),
    pixel: pixel === undefined || Object.keys(pixel).length === 0 ? undefined : pixel,
    roleName: scalarText(value.role_name ?? value.roleName),
    source: "device_mcp",
    observedAt,
  });
}

function prefer(candidate: Record<string, unknown>, previous: Record<string, unknown>): boolean {
  if (candidate.source === "mqtt_area_recon" && previous.source !== "mqtt_area_recon") return true;
  if (candidate.source !== "mqtt_area_recon" && previous.source === "mqtt_area_recon") return false;
  const candidateTime =
    typeof candidate.observedAt === "string" ? Date.parse(candidate.observedAt) : Number.NaN;
  const previousTime =
    typeof previous.observedAt === "string" ? Date.parse(previous.observedAt) : Number.NaN;
  if (
    Number.isFinite(candidateTime) &&
    Number.isFinite(previousTime) &&
    candidateTime !== previousTime
  )
    return candidateTime > previousTime;
  return richness(candidate) > richness(previous);
}

function richness(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((total, item) => total + richness(item), 1);
  if (record(value))
    return Object.values(value).reduce<number>((total, item) => total + richness(item), 1);
  return value === undefined || value === null ? 0 : 1;
}

function captureTime(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  const date = new Date(Math.floor(value / 1000));
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
