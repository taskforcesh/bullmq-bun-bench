/**
 * Sanity check: RESP3 SHOULD be measurably different from RESP2 when the
 * response uses a feature where RESP3 wins (HGETALL → map vs flat array,
 * CLIENT INFO → map, etc.). If we see a difference here, our RESP3
 * negotiation works and the BullMQ result (no difference) is genuinely
 * because BullMQ's Lua-script replies are flat strings/arrays that encode
 * identically in both protocols.
 *
 * Test: HSET a hash with K fields, then HGETALL it N times.
 * In RESP2, HGETALL returns a flat array [k1, v1, k2, v2, ...] that the
 * client must reassemble into an object. In RESP3 it returns a typed map
 * the parser builds directly.
 */
import { createClient } from "redis";

const N = 5000;
const K = 20;

async function bench(resp: 2 | 3) {
  const c: any = createClient({
    url: "redis://localhost:6379",
    RESP: resp,
  } as any);
  await c.connect();

  // Verify negotiation
  const hello = await c.sendCommand(["HELLO"]);
  const proto = Array.isArray(hello) ? hello[hello.indexOf("proto") + 1] : hello.proto;
  console.log(`  negotiated proto: ${proto}`);

  const key = `bench:hash:${resp}`;
  await c.del(key);
  const fields: string[] = [];
  for (let i = 0; i < K; i++) {
    fields.push(`f${i}`, `value-${i}-${"x".repeat(20)}`);
  }
  await c.sendCommand(["HSET", key, ...fields]);

  // warmup
  for (let i = 0; i < 500; i++) await c.hGetAll(key);

  const trials: number[] = [];
  for (let t = 0; t < 5; t++) {
    const start = performance.now();
    const ps: Promise<any>[] = [];
    for (let i = 0; i < N; i++) ps.push(c.hGetAll(key));
    await Promise.all(ps);
    trials.push(performance.now() - start);
    await new Promise((r) => setTimeout(r, 100));
  }
  await c.quit();
  trials.sort((a, b) => a - b);
  return {
    median: trials[2],
    min: trials[0],
    max: trials[4],
    opsPerSec: Math.round(N / (trials[2] / 1000)),
  };
}

console.log(`\n=== HGETALL × ${K} fields, ${N} parallel, 5 trials ===\n`);
console.log("RESP2:");
const r2 = await bench(2);
console.log(`  median ${r2.median.toFixed(1)}ms (min ${r2.min.toFixed(1)}, max ${r2.max.toFixed(1)})`);
console.log(`  ${r2.opsPerSec.toLocaleString()} HGETALL/sec\n`);

console.log("RESP3:");
const r3 = await bench(3);
console.log(`  median ${r3.median.toFixed(1)}ms (min ${r3.min.toFixed(1)}, max ${r3.max.toFixed(1)})`);
console.log(`  ${r3.opsPerSec.toLocaleString()} HGETALL/sec\n`);

const delta = ((r3.opsPerSec - r2.opsPerSec) / r2.opsPerSec) * 100;
console.log(
  `RESP3 vs RESP2 on HGETALL: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
);
process.exit(0);
