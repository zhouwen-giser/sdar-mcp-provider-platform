export class ProviderAdapterError extends Error {
  override readonly name = "ProviderAdapterError";
  constructor(
    readonly reasonCode: string,
    readonly retryable: boolean,
  ) {
    super(reasonCode);
  }
}

export function safeProviderError(error: unknown): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) return error;
  if (error instanceof DOMException && error.name === "AbortError")
    return new ProviderAdapterError("UGV_DOWNSTREAM_TIMEOUT", true);
  return new ProviderAdapterError("UGV_ADAPTER_INTERNAL_ERROR", true);
}
