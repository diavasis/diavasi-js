"use strict";

/**
 * Integration tests against a live diavasi data plane.
 *
 * Skipped unless DIAVASI_DATA_ADDR, DIAVASI_CA, and DIAVASI_API_TOKEN are set.
 * Default group is `sdk` (not `demo`). A finished synthetic group hangs until
 * the process is interrupted — recreate/start the group before each run.
 *
 *   npm run test:integration
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProtocolError, consume } = require("../index");

function configured() {
  const addr = process.env.DIAVASI_DATA_ADDR;
  const ca = process.env.DIAVASI_CA;
  const token = process.env.DIAVASI_API_TOKEN;
  if (!addr || !ca || !token) {
    return null;
  }
  return { addr, ca, token };
}

test("integration: consume acks every batch", async (t) => {
  const env = configured();
  if (!env) {
    t.skip("DIAVASI_DATA_ADDR, DIAVASI_CA, and DIAVASI_API_TOKEN are unset");
    return;
  }
  const total = Number(process.env.DIAVASI_TOTAL || "8");
  const report = await consume({
    ...env,
    groupId: process.env.DIAVASI_GROUP || "sdk",
    consumerId: "js-test",
    expectRecords: total,
  });
  if (report.recordIds.length !== total) {
    throw new Error(`records ${report.recordIds.length}`);
  }
});

test("integration: missing group is not running", async (t) => {
  const env = configured();
  if (!env) {
    t.skip("DIAVASI_DATA_ADDR, DIAVASI_CA, and DIAVASI_API_TOKEN are unset");
    return;
  }
  await assert.rejects(
    consume({
      ...env,
      groupId: "sdk-missing",
      consumerId: "js-missing",
    }),
    (err) => err instanceof ProtocolError && err.code === 5
  );
});
