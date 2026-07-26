import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

interface StoreDocument<T> {
  version: 1;
  records: Record<string, T>;
}

export class JsonFileStore<T> {
  readonly path: string;

  constructor(path?: string) {
    this.path = path ?? resolve(tmpdir(), `sdar-adapter-ts-${randomUUID()}.json`);
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existsSync(this.path)) this.#write({ version: 1, records: {} });
  }

  get(key: string): T | undefined {
    return this.#read().records[key];
  }

  set(key: string, value: T): void {
    const document = this.#read();
    document.records[key] = value;
    this.#write(document);
  }

  #read(): StoreDocument<T> {
    const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== 1 ||
      !("records" in value) ||
      typeof value.records !== "object" ||
      value.records === null
    ) {
      throw new Error("INVALID_ADAPTER_STATE_FILE");
    }
    return value as StoreDocument<T>;
  }

  #write(document: StoreDocument<T>): void {
    const temporary = `${this.path}.${String(process.pid)}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(document)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
