import { it } from "node:test";
import assert from "node:assert/strict";
import worker from "../apps/api/src/index.ts";
it("returns health and structured errors", async () => {
  const health = worker.fetch(new Request("https://v2.test/health"));
  assert.deepEqual(await health.json(), {
    status: "ok",
    service: "fiji-platform-v2-api",
  });
  const missing = worker.fetch(new Request("https://v2.test/nope"));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
});
