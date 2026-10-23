import { makeFixture } from "../test/fixture.js";
const fixture = await makeFixture(19105);
await fixture.app.listen({ host: "127.0.0.1", port: 19105 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void fixture.close();
  });
