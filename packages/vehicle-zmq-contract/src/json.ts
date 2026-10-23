import { requireContract, ZmqContractError } from "./error.js";

/** Check the original lexical JSON before JSON.parse can erase duplicate keys. */
export function parseWireJson(bytes: Buffer): unknown {
  requireContract(bytes.length > 0 && bytes.length <= 65_536, "ZMQ_JSON_SIZE_INVALID");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ZmqContractError("ZMQ_JSON_UTF8_INVALID");
  }
  let position = 0;
  let nodes = 0;
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(source[position] ?? "x")) position++;
  };
  const string = (): string => {
    const begin = position++;
    for (;;) {
      const char = source[position++];
      requireContract(char !== undefined, "ZMQ_JSON_SYNTAX_INVALID");
      if (char === "\\") position++;
      else if (char === '"') break;
    }
    let value: unknown;
    try {
      value = JSON.parse(source.slice(begin, position));
    } catch {
      throw new ZmqContractError("ZMQ_JSON_SYNTAX_INVALID");
    }
    requireContract(typeof value === "string", "ZMQ_JSON_SYNTAX_INVALID");
    requireContract(Buffer.byteLength(value) <= 65_536, "ZMQ_JSON_STRING_TOO_LARGE");
    return value;
  };
  const value = (depth: number): void => {
    requireContract(depth <= 16 && ++nodes <= 10_000, "ZMQ_JSON_COMPLEXITY_EXCEEDED");
    whitespace();
    const char = source[position];
    if (char === '"') {
      string();
      return;
    }
    if (char === "{" || char === "[") {
      const object = char === "{";
      const closing = object ? "}" : "]";
      const keys = new Set<string>();
      position++;
      whitespace();
      if (source[position] === closing) {
        position++;
        return;
      }
      for (;;) {
        if (object) {
          whitespace();
          requireContract(source[position] === '"', "ZMQ_JSON_SYNTAX_INVALID");
          const key = string();
          requireContract(!keys.has(key), "ZMQ_JSON_DUPLICATE_KEY");
          keys.add(key);
          whitespace();
          requireContract(source[position++] === ":", "ZMQ_JSON_SYNTAX_INVALID");
        }
        value(depth + 1);
        whitespace();
        const next = source[position++];
        if (next === closing) break;
        requireContract(next === ",", "ZMQ_JSON_SYNTAX_INVALID");
      }
      return;
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      source.slice(position),
    )?.[0];
    requireContract(token, "ZMQ_JSON_SYNTAX_INVALID");
    position += token.length;
    if (!/^(?:true|false|null)$/.test(token))
      requireContract(Number.isFinite(Number(token)), "ZMQ_JSON_NONFINITE_NUMBER");
  };
  value(0);
  whitespace();
  requireContract(position === source.length, "ZMQ_JSON_SYNTAX_INVALID");
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new ZmqContractError("ZMQ_JSON_SYNTAX_INVALID");
  }
}
