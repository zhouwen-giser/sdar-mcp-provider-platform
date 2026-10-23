export class ZmqContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ZmqContractError";
  }
}

export function requireContract(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ZmqContractError(code);
}
