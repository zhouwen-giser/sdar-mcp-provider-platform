import type { IncomingMessage, ServerResponse } from "node:http";

export interface HttpProtocolHandler {
  handle(request: IncomingMessage, response: ServerResponse, body: unknown): void | Promise<void>;
}

export class ProtocolRouter {
  constructor(
    readonly frozen: HttpProtocolHandler,
    readonly legacy: HttpProtocolHandler | undefined,
    readonly legacyEnabled: boolean,
  ) {}

  handler(path: string): HttpProtocolHandler | undefined {
    if (path === "/mcp") return this.frozen;
    if (path === "/mcp/legacy" && this.legacyEnabled) return this.legacy;
    return undefined;
  }

  async handle(
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
    body: unknown,
  ): Promise<boolean> {
    const handler = this.handler(path);
    if (handler === undefined) return false;
    await handler.handle(request, response, body);
    return true;
  }
}
