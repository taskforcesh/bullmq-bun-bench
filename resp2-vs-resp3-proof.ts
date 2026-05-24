/**
 * RESP2 vs RESP3 throughput, on Bun runtime, for the two clients that
 * support both: ioredis and node-redis.
 *
 * Bun's built-in RedisClient is RESP3-only, so we include it once for
 * reference at the bottom.
 *
 * Measures both shapes:
 *   - 3× EVALSHA without MULTI (pipelined parallel commands)
 *   - 3× EVALSHA inside MULTI/EXEC (FlowProducer shape)
 */

import IORedis from "ioredis";
import { createClient } from "redis";
import { RedisClient as BunRedis } from "bun";

const REDIS_URL = "redis://localhost:6379";
const LUA = "return ARGV[1]";
const N = 2000;
const K = 3;
const TRIALS = 5;

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return {
    median: s[Math.floor(s.length / 2)],
    min: s[0],
    max: s[s.length - 1],
    stddev: Math.sqrt(variance),
  };
}

async function bench(label: string, run: () => Promise<number>) {
  const trials: number[] = [];
  for (let i = 0; i < 5; i++) {
    trials.push(await run());
    await new Promise((r) => setTimeout(r, 100));
  }
  const s = stats(trials);
  const blocks = N / (s.median / 1000);
  console.log(
    `${label.padEnd(34)}  median ${s.median.toFixed(1).padStart(7)}ms  ` +
      `min ${s.min.toFixed(1).padStart(7)}ms  ` +
      `max ${s.max.toFixed(1).padStart(7)}ms  ` +
      `stddev ${s.stddev.toFixed(2).padStart(6)}  ` +
      `${Math.round(blocks).toLocaleString().padStart(9)} blocks/s`,
  );
}

// ---------- ioredis ----------
async function ioredisRun(protocol: 2 | 3, multi: boolean) {
  const c: any = new IORedis({
    maxRetriesPerRequest: null,
    protocol,
  } as any);
  // Wait for connection ready (some RESP3 negotiation happens lazily)
  await c.ping();
  const sha = (await c.script("LOAD", LUA)) as string;
  for (let i = 0; i < 200; i++) {
    if (multi) {
      const m = c.multi();
      for (let j = 0; j < K; j++) m.evalsha(sha, 0, "x");
      await m.exec();
    } else {
      const ps: Promise<any>[] = [];
      for (let j = 0; j < K; j++) ps.push(c.evalsha(sha, 0, "x"));
      await Promise.all(ps);
    }
  }
  const start = performance.now();
  const all: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    if (multi) {
      const m = c.multi();
      for (let j = 0; j < K; j++) m.evalsha(sha, 0, "x");
      all.push(m.exec());
    } else {
      for (let j = 0; j < K; j++) all.push(c.evalsha(sha, 0, "x"));
    }
  }
  await Promise.all(all);
  const elapsed = performance.now() - start;
  await c.quit();
  return elapsed;
}

// ---------- node-redis ----------
async function nodeRedisRun(resp: 2 | 3, multi: boolean) {
  const c = createClient({ url: REDIS_URL, RESP: resp } as any);
  await c.connect();
  const sha = (await c.sendCommand(["SCRIPT", "LOAD", LUA])) as string;
  for (let i = 0; i < 200; i++) {
    if (multi) {
      const m = c.multi();
      for (let j = 0; j < K; j++) m.addCommand(["EVALSHA", sha, "0", "x"]);
      await m.exec();
    } else {
      const ps: Promise<any>[] = [];
      for (let j = 0; j < K; j++)
        ps.push(c.sendCommand(["EVALSHA", sha, "0", "x"]));
      await Promise.all(ps);
    }
  }
  const start = performance.now();
  const all: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    if (multi) {
      const m = c.multi();
      for (let j = 0; j < K; j++) m.addCommand(["EVALSHA", sha, "0", "x"]);
      all.push(m.exec());
    } else {
      for (let j = 0; j < K; j++)
        all.push(c.sendCommand(["EVALSHA", sha, "0", "x"]));
    }
  }
  await Promise.all(all);
  const elapsed = performance.now() - start;
  await c.quit();
  return elapsed;
}

// ---------- bun-native (RESP3 only) ----------
async function bunRun(multi: boolean) {
  const c = new BunRedis(REDIS_URL);
  await c.connect();
  const sha = (await c.send("SCRIPT", ["LOAD", LUA])) as string;
  for (let i = 0; i < 200; i++) {
    if (multi) {
      c.send("MULTI", []);
      for (let j = 0; j < K; j++) c.send("EVALSHA", [sha, "0", "x"]);
      await c.send("EXEC", []);
    } else {
      const ps: Promise<any>[] = [];
      for (let j = 0; j < K; j++) ps.push(c.send("EVALSHA", [sha, "0", "x"]));
      await Promise.all(ps);
    }
  }
  const start = performance.now();
  const all: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    if (multi) {
      c.send("MULTI", []);
      for (let j = 0; j < K; j++) c.send("EVALSHA", [sha, "0", "x"]);
      all.push(c.send("EXEC", []));
    } else {
      for (let j = 0; j < K; j++) all.push(c.send("EVALSHA", [sha, "0", "x"]));
    }
  }
  await Promise.all(all);
  const elapsed = performance.now() - start;
  c.close();
  return elapsed;
}

console.log(`\nRuntime: Bun ${Bun.version}`);
console.log(`Workload: ${N} batches × ${K} EVALSHA, ${TRIALS} trials\n`);

console.log("--- Pipelined (no MULTI/EXEC) ---");
await bench("ioredis     RESP2", () => ioredisRun(2, false));
await bench("ioredis     RESP3", () => ioredisRun(3, false));
await bench("node-redis  RESP2", () => nodeRedisRun(2, false));
await bench("node-redis  RESP3", () => nodeRedisRun(3, false));
await bench("bun-native  RESP3", () => bunRun(false));

console.log("\n--- MULTI/EXEC wrapped ---");
await bench("ioredis     RESP2", () => ioredisRun(2, true));
await bench("ioredis     RESP3", () => ioredisRun(3, true));
await bench("node-redis  RESP2", () => nodeRedisRun(2, true));
await bench("node-redis  RESP3", () => nodeRedisRun(3, true));
await bench("bun-native  RESP3", () => bunRun(true));

process.exit(0);
