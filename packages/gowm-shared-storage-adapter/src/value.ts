export function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("GOWM_STORAGE_REQUIRED_VALUE_MISSING");
  return value;
}
