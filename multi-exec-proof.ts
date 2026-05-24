/**
 * MULTI/EXEC throughput comparison — rigorous proof harness.
 *
 * Runs the SAME workload (N MULTI/EXEC blocks, each with K EVALSHAs of a
 * trivial script) against three Redis clients on the Bun runtime:
 *   1. ioredis           (Node-style client, runs on Bun)
 *   2. node-redis        (@redis/client v5)
 *   3. Bun's built-in    (bun:redis RedisClient)
 *
 * For each combination we run TRIALS trials and report median + min + max +
 * stddev. Throughput is computed from the median.
 *
 * Trivial Lua: `return ARGV[1]` — eliminates server-side work, isolating
 * client serialization + socket I/O overhead.
 */

import IORedis from "ioredis";
import { createClient } from "redis";
import { RedisClient as BunRedis } from "bun";

const REDIS_URL = "redis://localhost:6379";
const TRIVIAL_LUA = "return ARGV[1]";

const SHAPES = [
  { name: "1-cmd", k: 1 },
  { name: "3-cmd", k: 3 },
  { name: "10-cmd", k: 10 },
];
const N = 2000;
const TRIALS = 5;

interface Result {
  client: string;
  shape: string;
  k: number;
  trialsMs: number[];
}

function stats(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { median, min, max, mean, stddev: Math.sqrt(variance) };
}

async function runIORedis(k: number): Promise<number> {
  const c = new IORedis({ maxRetriesPerRequest: null, lazyConnect: false });
  const sha = (await c.script("LOAD", TRIVIAL_LUA)) as string;

  for (let i = 0; i < 200; i++) {
    const m = c.multi();
    for (let j = 0; j < k; j++) m.evalsha(sha, 0, "x");
    await m.exec();
  }

  const start = performance.now();
  const promises: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    const m = c.multi();
    for (let j = 0; j < k; j++) m.evalsha(sha, 0, "x");
    promises.push(m.exec() as Promise<any>);
  }
  await Promise.all(promises);
  const elapsed = performance.now() - start;
  await c.quit();
  return elapsed;
}

async function runNodeRedis(k: number): Promise<number> {
  const c = createClient({ url: REDIS_URL });
  await c.connect();
  const sha = (await c.sendCommand(["SCRIPT", "LOAD", TRIVIAL_LUA])) as string;

  for (let i = 0; i < 200; i++) {
    const m = c.multi();
    for (let j = 0; j < k; j++) m.addCommand(["EVALSHA", sha, "0", "x"]);
    await m.exec();
  }

  const start = performance.now();
  const promises: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    const m = c.multi();
    for (let j = 0; j < k; j++) m.addCommand(["EVALSHA", sha, "0", "x"]);
    promises.push(m.exec());
  }
  await Promise.all(promises);
  const elapsed = performance.now() - start;
  await c.quit();
  return elapsed;
}

async function runBunNative(k: number): Promise<number> {
  const c = new BunRedis(REDIS_URL);
  await c.connect();
  const sha = (await c.send("SCRIPT", ["LOAD", TRIVIAL_LUA])) as string;

  for (let i = 0; i < 200; i++) {
    c.send("MULTI", []);
    for (let j = 0; j < k; j++) c.send("EVALSHA", [sha, "0", "x"]);
    await c.send("EXEC", []);
  }

  const start = performance.now();
  const promises: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    c.send("MULTI", []);
    for (let j = 0; j < k; j++) c.send("EVALSHA", [sha, "0", "x"]);
    promises.push(c.send("EXEC", []));
  }
  await Promise.all(promises);
  const elapsed = performance.now() - start;
  c.close();
  return elapsed;
}

async function trial(
  name: string,
  k: number,
  fn: (k: number) => Promise<number>,
): Promise<Result> {
  const trials: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    const ms = await fn(k);
    trials.push(ms);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { client: name, shape: `${k}-cmd`, k, trialsMs: trials };
}

const results: Result[] = [];

for (const { k } of SHAPES) {
  console.log(
    `\n=== Shape: MULTI + ${k}× EVALSHA + EXEC, ${N} blocks, ${TRIALS} trials ===`,
  );
  for (const [name, fn] of [
    ["ioredis", runIORedis],
    ["node-redis", runNodeRedis],
    ["bun-native", runBunNative],
  ] as const) {
    process.stdout.write(`  ${name}... `);
    const r = await trial(name, k, fn);
    results.push(r);
    const s = stats(r.trialsMs);
    console.log(
      `median ${s.median.toFixed(1)}ms (min ${s.min.toFixed(1)}, max ${s.max.toFixed(1)})`,
    );
  }
}

console.log(
  "\n\n========================================================================",
);
console.log("RESULTS  (lower median = faster)");
console.log(
  "========================================================================",
);

const headers = [
  "shape",
  "client",
  "median ms",
  "min ms",
  "max ms",
  "stddev",
  "blocks/s",
  "cmds/s",
  "µs/block",
];
console.log(headers.map((s) => s.padEnd(13)).join(""));
console.log("-".repeat(13 * headers.length));

for (const r of results) {
  const s = stats(r.trialsMs);
  const blocksPerSec = N / (s.median / 1000);
  const cmdsPerSec = blocksPerSec * r.k;
  const usPerBlock = (s.median * 1000) / N;

  console.log(
    [
      r.shape,
      r.client,
      s.median.toFixed(1),
      s.min.toFixed(1),
      s.max.toFixed(1),
      s.stddev.toFixed(2),
      Math.round(blocksPerSec).toLocaleString(),
      Math.round(cmdsPerSec).toLocaleString(),
      usPerBlock.toFixed(1),
    ]
      .map((s) => String(s).padEnd(13))
      .join(""),
  );
}

console.log("\nRuntime:            Bun " + Bun.version);
console.log("Trivial Lua script: " + JSON.stringify(TRIVIAL_LUA));
console.log("N blocks per trial: " + N);
console.log("Trials per cell:    " + TRIALS);
process.exit(0);
