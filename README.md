# BullMQ Runtime Benchmark

Benchmark comparing BullMQ performance on **Node.js** vs **Bun** runtimes.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+ 
- [Bun](https://bun.sh/) v1.0+
- Redis server running on localhost (or set `REDIS_HOST` env var)
- BullMQ with the `node-redis` and `bun` Redis client adapters
  (`createNodeRedisClient`, `createBunRedisClient`). If your installed
  version only exposes `createIORedisClient`, run `npm install bullmq@latest`
  before reproducing the adapter-comparison and proof-harness benchmarks.

## Installation

```bash
# Using npm
npm install

# Using Bun (faster)
bun install
```

## Running Benchmarks

There are two benchmark scripts:
- `benchmark.js` - Simple JavaScript benchmark
- `runtime-comparison.ts` - Comprehensive TypeScript benchmark with more tests

### Simple Benchmark (JavaScript)

```bash
# Node.js
npm run bench:node

# Bun
npm run bench:bun
```

### Comprehensive Benchmark (TypeScript)

```bash
# Node.js (using tsx)
npm run bench:node:ts

# Bun
npm run bench:bun:ts
```

## Benchmark Tests

1. **Job Addition** - Adding 1000 jobs individually using `Queue.add()`
2. **Bulk Addition** - Adding 5000 jobs at once using `Queue.addBulk()`
3. **Job Processing** - Processing 1000 jobs with concurrency=10
4. **Flow Producer** - Creating 100 flows with 2 children each

## Redis Client Adapter Comparison

BullMQ supports three Redis client adapters:

- `ioredis` (default, RESP2 only — ioredis 5.x does not yet support RESP3)
- `node-redis` (`@redis/client` v5, supports RESP2 and RESP3)
- `bun` (Bun's built-in `RedisClient`, RESP3 only, Bun runtime required)

Run the same end-to-end BullMQ workload against each adapter:

```bash
# On Node.js (uses tsx)
npm run bench:adapter:ioredis
npm run bench:adapter:node-redis

# Opt-in RESP3 for node-redis
npm run bench:adapter:node-redis:resp3

# On Bun (required for bun-native)
npm run bench:adapter:bun
```

Optional env vars: `NUM_JOBS` (default 50000), `CONCURRENCY` (default 100),
`PROTOCOL` (2 or 3, only meaningful for `node-redis`).

## Proof Harnesses (MULTI/EXEC investigation)

The companion article
[*BullMQ on Bun — Choosing a Redis Client Adapter*](https://bullmq.io/articles/benchmarks/bullmq-bun-redis-adapters/)
investigates why `bun-native` is slower at Flow Producer than the other two
adapters. These scripts let you reproduce that investigation on your own
machine. All run on the Bun runtime and report median / min / max / stddev
over 5 trials.

```bash
# Throughput of K parallel EVALSHAs per batch, NO MULTI/EXEC.
# Shows bun-native is the fastest client for non-transactional pipelining.
bun run proof:pipelined

# Same K × EVALSHA per batch, this time wrapped in MULTI/EXEC.
# Shows bun-native collapses ~7-19x while ioredis/node-redis stay flat.
bun run proof:multi-exec

# Apples-to-apples RESP2 vs RESP3 comparison for the clients that support
# both (node-redis), with the same shapes as the two scripts above.
bun run proof:resp2-vs-resp3

# Sanity check: an HGETALL workload where RESP3 SHOULD beat RESP2.
# Demonstrates that RESP3 negotiation works and that the lack of RESP3
# gains on the BullMQ workloads above is not a methodology bug.
bun run proof:resp3-sanity
```

## Environment Variables

- `REDIS_HOST` - Redis host (default: `localhost`)
- `REDIS_PORT` - Redis port (default: `6379`)
- `NUM_JOBS` - Jobs per benchmark (default: `50000`)
- `CONCURRENCY` - Worker concurrency (default: `100`)
- `PROTOCOL` - `2` or `3`, RESP protocol for node-redis (default: `2`)
- `ADAPTER` - `ioredis`, `node-redis`, or `bun` (default: `ioredis`)

## License

MIT
