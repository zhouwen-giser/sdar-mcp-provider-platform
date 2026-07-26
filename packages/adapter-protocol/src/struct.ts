export type ProtoValue =
  | { nullValue: 0 }
  | { numberValue: number }
  | { stringValue: string }
  | { boolValue: boolean }
  | { listValue: { values: ProtoValue[] } }
  | { structValue: ProtoStruct };

export interface ProtoStruct {
  fields: Record<string, ProtoValue>;
}

export function jsonToProtoValue(value: unknown): ProtoValue {
  if (value === null) return { nullValue: 0 };
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map(jsonToProtoValue) } };
  if (typeof value === "object")
    return { structValue: jsonToProtoStruct(value as Record<string, unknown>) };
  throw new TypeError(`Unsupported protobuf Struct value: ${typeof value}`);
}

function fromProtoValue(value: ProtoValue): unknown {
  if ("nullValue" in value) return null;
  if ("numberValue" in value) return value.numberValue;
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("listValue" in value) return value.listValue.values.map(fromProtoValue);
  return protoStructToJson(value.structValue);
}

export function jsonToProtoStruct(value: Record<string, unknown>): ProtoStruct {
  return {
    fields: Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonToProtoValue(item)]),
    ),
  };
}

export function protoStructToJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || !("fields" in value)) return {};
  const fields = (value as ProtoStruct).fields;
  return Object.fromEntries(
    Object.entries(fields).map(([key, item]) => [key, fromProtoValue(item)]),
  );
}
