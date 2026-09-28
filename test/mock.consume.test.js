"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const grpc = require("@grpc/grpc-js");
const { ProtocolError, CallError, consume, loadClient } = require("../index");

/**
 * Consume against an in-process data-plane stand-in.
 *
 * A group named `sdk-missing` is protocol error 5. Any other group yields
 * record ids 1 through 8 in one batch. A bearer token of `bad-token` is
 * UNAUTHENTICATED.
 */
async function withFakeClient(run) {
  const DataPlane = loadClient(require("path").join(__dirname, "../proto/data.proto"));
  const server = new grpc.Server();
  server.addService(DataPlane.service, {
    Consume(call) {
      call.on("data", (env) => {
        switch (env.body) {
          case "hello":
            call.write({ version: 1, hello_ack: { protocol_version: 1 } });
            return;
          case "join_group": {
            const auth = call.metadata.get("authorization")[0];
            if (auth === "Bearer bad-token") {
              const err = new Error("unauthorized");
              err.code = grpc.status.UNAUTHENTICATED;
              err.details = "unauthorized";
              call.emit("error", err);
              return;
            }
            if (env.join_group.group_id === "sdk-missing") {
              call.write({
                version: 1,
                error: { code: 5, message: "not running" },
              });
              call.end();
              return;
            }
            call.write({ version: 1, joined: {} });
            return;
          }
          case "flow_control": {
            const records = [];
            for (let id = 1; id <= 8; id++) {
              records.push({ record_id: id, payload: Buffer.from("abcdefgh") });
            }
            call.write({
              version: 1,
              record_batch: { batch_id: 1, records },
            });
            return;
          }
          case "heartbeat":
            call.write({ version: 1, heartbeat: {} });
            return;
          case "leave":
            call.end();
            return;
          default:
            return;
        }
      });
      call.on("end", () => call.end());
    },
  });

  const port = await new Promise((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, bound) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(bound);
    });
  });
  const client = new DataPlane(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  try {
    await run(client);
  } finally {
    client.close();
    await new Promise((resolve) => server.tryShutdown(resolve));
  }
}

test("mock: fresh group returns ids and acks", async () => {
  await withFakeClient(async (client) => {
    const report = await consume({
      client,
      token: "sdk-demo",
      groupId: "sdk",
      consumerId: "js-test",
      expectRecords: 8,
    });
    assert.deepEqual(report.recordIds, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(report.batchIds, [1]);
  });
});

test("mock: missing group is protocol error 5", async () => {
  await withFakeClient(async (client) => {
    await assert.rejects(
      consume({
        client,
        token: "sdk-demo",
        groupId: "sdk-missing",
        consumerId: "js-missing",
        expectRecords: 1,
      }),
      (err) => err instanceof ProtocolError && err.code === 5 && /not running/.test(err.message)
    );
  });
});

test("mock: bad token is UNAUTHENTICATED", async () => {
  await withFakeClient(async (client) => {
    await assert.rejects(
      consume({
        client,
        token: "bad-token",
        groupId: "sdk",
        consumerId: "js-bad",
        expectRecords: 1,
      }),
      (err) => err instanceof CallError && err.status === "UNAUTHENTICATED" && /unauthorized/.test(err.message)
    );
  });
});

test("mock: ProtocolError message includes code", () => {
  const err = new ProtocolError(5, "not running");
  assert.equal(err.code, 5);
  assert.equal(err.message, "protocol error 5: not running");
});
