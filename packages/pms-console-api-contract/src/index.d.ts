import type { ProblemDetails } from "./dto.js";

export declare const PMS_CONSOLE_API_CONTRACT_TARGET_VERSION: "1.0.0";
export declare const PMS_CONSOLE_API_CONTRACT_STATUS: "frozen";
export declare const PMS_CONSOLE_API_AUTHENTICATION_SCOPE: "deferred";
export declare const PMS_CONSOLE_API_BASE_PATH: "/api/console/v1";
export declare function isProblemDetails(value: unknown): value is ProblemDetails;
export * from "./dto.js";
