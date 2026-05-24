/**
 * Non-transactional pipelined throughput.
 *
 * Same workload (K × EVALSHA per "batch", N batches) but WITHOUT wrapping in
 * MULTI/EXEC. This proves Bun's client is fast at single-command pipelining
 * and isolates MULTI/EXEC framing as the culprit for the gap measured in
 * `multi-exec-proof.ts`.
 */

import IORedis from "ioredis";
import { createClient } from "redis";
import { RedisClient as BunRedis } from "bun";

const REDIS_URL = "redis://localhost:6379";
const TRIVIAL_LUA = "return ARGV[1]";

const SHAPES = [
  { k: 1 },
  { k: 3 },
  { k: 10 },
];
const N = 2000;
const TRIALS = 5;

function stats(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function runIORedis(k: number): Promise<number> {
  const c = new IORedis({ maxRetriesPerRequest: null });
  const sha = (await c.script("LOAD", TRIVIAL_LUA)) as string;
  for (let i = 0; i < 200; i++) {
    const ps: Promise<any>[] = [];
    for (let j = 0; j < k; j++) ps.push(c.evalsha(sha, 0, "x") as Promise<any>);
    await Promise.all(ps);
  }
  const start = performance.now();
  const all: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < k; j++) all.push(c.evalsha(sha, 0, "x") as Promise<any>);
  }
  await Promise.all(all);
  const elapsed = performance.now() - start;
  await c.quit();
  return elapsed;
}

async function runNodeRedis(k: number): Promise<number> {
  const c = createClient({ url: REDIS_URL });
  await c.connect();
  const sha = (await c.sendCommand(["SCRIPT", "LOAD", TRIVIAL_LUA])) as string;
  for (let i = 0; i < 200; i++) {
    const ps: Promise<any>[] = [];
    for (let j = 0; j < k; j++)
      ps.push(c.sendCommand(["EVALSHA", sha, "0", "x"]));
    await Promise.all(ps);
  }
  const start = performance.now();
  const all: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < k; j++) all.push(c.sendCommand(["EVALSHA", sha, "0", "x"]));
  }
  await Promise.all(all);
  const elapsed = performance.now() - start;
  await c.quit();
  return elapsed;
}

async function runBunNative(k: number): Promise<number> {
  const c = new BunRedis(REDIS_URL);
  await c.connect();
  const sha = (await c.send("SCRIPT", ["LOAD", TRIVIAL_LUA])) as string;
  for (let i = 0; i < 200; i++) {
    const ps: Promise<any>[] = [];
    for (let j = 0; j < k; j++) ps.push(c.send("EVALSHA", [sha, "0", "x"]));
    await Promise.all(ps);
  }
  const start = performance.now();
  const all: Promise<any>[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < k; j++) all.push(c.send("EVALSHA", [sha, "0", "x"]));
  }
  await Promise.all(all);
  const elapsed = performance.now() - start;
  c.close();
  return elapsed;
}

interface R { client: string; k: number; trialsMs: number[]; }
const results: R[] = [];

for (const { k } of SHAPES) {
  console.log(`\n=== ${k}× EVALSHA per batch (NO MULTI), ${N} batches ===`);
  for (const [name, fn] of [
    ["ioredis", runIORedis],
    ["node-redis", runNodeRedis],
    ["bun-native", runBunNative],
  ] as const) {
    process.stdout.write(`  ${name}... `);
    const trialsMs: number[] = [];
    for (let t = 0; t < TRIALS; t++) {
      trialsMs.push(await fn(k));
      await new Promise(r => setTimeout(r, 100));
    }
    const s = stats(trialsMs);
    results.push({ client: name, k, trialsMs });
    console.log(`median ${s.median.toFixed(1)}ms`);
  }
}

console.log("\n========================================================================");
console.log("RESULTS — NON-TRANSACTIONAL (no MULTI/EXEC)");
console.log("========================================================================");
const hdr = ["shape", "client", "median ms", "blocks/s", "cmds/s", "µs/cmd"];
console.log(hdr.map(s => s.padEnd(13)).join(""));
console.log("-".repeat(13 * hdr.length));
for (const r of results) {
  const s = stats(r.trialsMs);
  const blocksPerSec = N / (s.median / 1000);
  const cmdsPerSec = blocksPerSec * r.k;
  const usPerCmd = (s.median * 1000) / (N * r.k);
  console.log([
    `${r.k}-cmd`, r.client, s.median.toFixed(1),
    Math.round(blocksPerSec).toLocaleString(),
    Math.round(cmdsPerSec).toLocaleString(),
    usPerCmd.toFixed(2),
  ].map(s => String(s).padEnd(13)).join(""));
}
console.log("\nRuntime: Bun " + Bun.version);
process.exit(0);
