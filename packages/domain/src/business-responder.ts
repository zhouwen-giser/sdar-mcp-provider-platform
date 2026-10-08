/** Internal provenance created by Runtime configuration/authentication, never by public JSON. */
export type RuntimeBusinessResponder =
  | {
      actorType: "user" | "agent" | "operator";
      actorId: string;
      source: "jwt_hs256" | "trusted_headers";
    }
  | {
      actorType: "development_anonymous";
      actorId: "development-anonymous";
      source: "development";
    };

export function isRuntimeBusinessResponder(value: unknown): value is RuntimeBusinessResponder {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  if (fields.source === "development") {
    return (
      fields.actorType === "development_anonymous" && fields.actorId === "development-anonymous"
    );
  }
  return (
    (fields.source === "jwt_hs256" || fields.source === "trusted_headers") &&
    ["user", "agent", "operator"].includes(String(fields.actorType)) &&
    typeof fields.actorId === "string" &&
    fields.actorId.length > 0
  );
}
