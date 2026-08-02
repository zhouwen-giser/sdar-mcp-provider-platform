export const PMS_CONSOLE_API_CONTRACT_TARGET_VERSION = "1.0.0";
export const PMS_CONSOLE_API_CONTRACT_STATUS = "frozen";
export const PMS_CONSOLE_API_AUTHENTICATION_SCOPE = "deferred";
export const PMS_CONSOLE_API_BASE_PATH = "/api/console/v1";
export function isProblemDetails(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.code === "string" &&
    Number.isInteger(value.status) &&
    typeof value.title === "string",
  );
}
