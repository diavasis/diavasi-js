# JavaScript client

[![CI](https://github.com/diavasis/diavasi-js/actions/workflows/ci.yml/badge.svg)](https://github.com/diavasis/diavasi-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@diavasi/data.svg)](https://www.npmjs.com/package/@diavasi/data)
[![license](https://img.shields.io/github/license/diavasis/diavasi-js)](https://github.com/diavasis/diavasi-js/blob/main/LICENSE)

`@diavasi/data` is a thin client of `diavasi.data.v1`, built on `@grpc/grpc-js`. `consume` opens a TLS stream, sends the bearer token, Hello version 1, then JoinGroup, and acks each batch. The client stores no cursor and does not dedupe on `record_id`. A dropped stream is how unacked batches return. Reconnect with the same consumer id and the server replays them.

`proto/data.proto` in this repository is the copy of `diavasi.data.v1` from [github.com/diavasis/diavasi](https://github.com/diavasis/diavasi) tag `v0.13.0`. The npm package `@diavasi/data` is version 0.1.0. TypeScript types are in `index.d.ts`.

## Install

```bash
npm install @diavasi/data@0.1.0
```

From a checkout of this repository, `npm install` installs the gRPC dependencies used by the example.

## Library

```js
const { CallError, ProtocolError, consume } = require("@diavasi/data");

try {
  const report = await consume({
    addr: "127.0.0.1:7710",
    ca: "/tmp/diavasi-sdk/dataplane-ca.crt",
    token: "sdk-demo",
    groupId: "demo",
    consumerId: "js",
    expectRecords: 8,
    onBatch(batch) {
      for (const record of batch.records) {
        console.log(
          `batch ${batch.batchId} record ${record.recordId} (${record.payload.length} bytes)`,
        );
      }
    },
  });
  console.log(report.recordIds);
} catch (err) {
  if (err instanceof ProtocolError) {
    console.error(`protocol ${err.code}: ${err.message}`);
  } else if (err instanceof CallError) {
    console.error(`grpc ${err.status}: ${err.message}`);
  } else {
    throw err;
  }
}
```

`onBatch` runs before the ack. `maxInFlight` defaults to 1. `haltAfterAcks` closes after that many acks and does not send Leave. `expectRecords` sends Leave once that many records are acked. `protoPath` overrides the path to `data.proto` (the default walks to `crates/diavasi/proto/data.proto`; set `DIAVASI_PROTO` in the Compose image).

`ProtocolError` carries codes 1 through 8: bad version, bad state, unknown ack, duplicate ack, group not running, unsupported, internal, heartbeat timeout. `CallError` is a gRPC status. A bad token is `UNAUTHENTICATED` with message `unauthorized`. A group that is not running is protocol code 5.

## Run

Start the server from the repo root:

```bash
cargo build -p diavasi
export PATH="$PWD/target/debug:$PATH"
mkdir -p /tmp/diavasi-sdk
diavasi serve --bind 127.0.0.1:7700 --data-bind 127.0.0.1:7710 \
  --store /tmp/diavasi-sdk/state --token sdk-demo
```

In a second terminal, from the repo root:

```bash
curl -fsS -X POST -H "Authorization: Bearer sdk-demo" \
  http://127.0.0.1:7700/v1/groups/demo/pause || true
curl -fsS -X DELETE -H "Authorization: Bearer sdk-demo" \
  http://127.0.0.1:7700/v1/groups/demo || true
curl -fsS -H "Authorization: Bearer sdk-demo" -H "content-type: application/json" \
  -d '{"group_id":"demo","total_records":8,"payload_size":8,"max_buffer_records":64,"max_buffer_bytes":65536,"batch_max_records":4,"batch_timeout_ms":200,"ordering_contract":"synthetic-u64"}' \
  http://127.0.0.1:7700/v1/groups
curl -fsS -X POST -H "Authorization: Bearer sdk-demo" \
  http://127.0.0.1:7700/v1/groups/demo/start

npm install
node examples/process.js
```

Pause, delete, create, and start the group before another run. Delete returns 409 while it is running, and start resumes the cursor. A finished synthetic group leaves the client waiting on heartbeats.

`examples/process.js` is the program above. `examples/consume.js` is the flag client used by the compatibility suite:

```bash
node examples/consume.js --addr 127.0.0.1:7710 --ca /tmp/diavasi-sdk/dataplane-ca.crt \
  --token sdk-demo --group demo --consumer js --total 8
```

Flags: `--addr`, `--ca`, `--token`, `--group`, `--consumer`, `--total`, `--max-in-flight` (default 1), `--halt-after`. The last occurrence of a flag wins. The example prints `record_ids` and `batch_ids`.

```bash
docker compose -f clients/docker-compose.yml --profile js up --abort-on-container-exit
```

## Test

There is no compile step. Install dependencies, then run the mock suite (always, no server):

```bash
npm install
npm test
```

`npm test` runs `node --test` on `test/mock*.test.js`. Those tests drive `consume` against an in-process fake `DataPlane`: a fresh group returns record ids 1 through 8, `sdk-missing` is protocol error 5, and a bearer token of `bad-token` is `UNAUTHENTICATED`. CI runs this suite only.

Coverage over the mock suite (via [c8](https://github.com/bcoe/c8)):

```bash
npm run test:coverage
```

### Integration (live data plane)

`npm run test:integration` runs `test/integration*.test.js`. When `DIAVASI_DATA_ADDR`, `DIAVASI_CA`, and `DIAVASI_API_TOKEN` are **unset**, both tests skip immediately. If those variables are set (including leftovers from an earlier session), the suite does **not** skip: the first test joins `DIAVASI_GROUP` (default **`sdk`**, not `demo`) as consumer `js-test` and waits for `DIAVASI_TOTAL` records (default 8). A wrong group name, a finished synthetic group, or a group that never starts leaves the command blocked on heartbeats until you Ctrl+C.

Skip without clearing your shell permanently:

```bash
env -u DIAVASI_DATA_ADDR -u DIAVASI_CA -u DIAVASI_API_TOKEN npm run test:integration
```

Live-server run against a fresh group (match the group id you create):

```bash
curl -fsS -X POST -H "Authorization: Bearer sdk-demo" \
  http://127.0.0.1:7700/v1/groups/sdk/pause || true
curl -fsS -X DELETE -H "Authorization: Bearer sdk-demo" \
  http://127.0.0.1:7700/v1/groups/sdk || true
curl -fsS -H "Authorization: Bearer sdk-demo" -H "content-type: application/json" \
  -d '{"group_id":"sdk","total_records":8,"payload_size":8,"max_buffer_records":64,"max_buffer_bytes":65536,"batch_max_records":4,"batch_timeout_ms":200,"ordering_contract":"synthetic-u64"}' \
  http://127.0.0.1:7700/v1/groups
curl -fsS -X POST -H "Authorization: Bearer sdk-demo" \
  http://127.0.0.1:7700/v1/groups/sdk/start

export DIAVASI_DATA_ADDR=127.0.0.1:7710
export DIAVASI_CA=/tmp/diavasi-sdk/dataplane-ca.crt
export DIAVASI_API_TOKEN=sdk-demo
export DIAVASI_GROUP=sdk
export DIAVASI_TOTAL=8
npm run test:integration
```

Pause, delete, create, and start the group before another live run. The second test joins `sdk-missing` and expects protocol error 5.
