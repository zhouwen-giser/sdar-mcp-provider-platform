import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { TaskRepository } from "../../packages/persistence-postgres/src/index.js";

describe("H7 Observation pagination", () => {
  it("returns newest bounded revisions with a cursor for the next page", async () => {
    const queries: unknown[][] = [];
    const pool = {
      query: (_sql: string, values: unknown[]) => {
        queries.push(values);
        return Promise.resolve({
          rows: [row(5), row(4), row(3)],
        });
      },
    } as unknown as Pool;
    const repository = new TaskRepository(pool);

    await expect(repository.listObservationPage("task", undefined, 2)).resolves.toMatchObject({
      observations: [{ revision: 5 }, { revision: 4 }],
      nextCursor: 4,
      hasMore: true,
    });
    expect(queries[0]).toEqual(["task", null, 3]);
  });

  it("rejects invalid cursors and page sizes", async () => {
    const repository = new TaskRepository({} as Pool);
    await expect(repository.listObservationPage("task", 0, 10)).rejects.toThrow(
      "OBSERVATION_CURSOR_INVALID",
    );
    await expect(repository.listObservationPage("task", 1, 101)).rejects.toThrow(
      "OBSERVATION_PAGE_SIZE_INVALID",
    );
  });
});

function row(revision: number) {
  return {
    revision: String(revision),
    type: "task.progress",
    occurred_at: new Date(),
    reason_code: null,
    message: null,
    substate: null,
    progress: null,
    source: "runtime" as const,
    adapter_revision: null,
    payload: {},
  };
}
