export class ConsoleRequestMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleRequestMappingError";
  }
}
