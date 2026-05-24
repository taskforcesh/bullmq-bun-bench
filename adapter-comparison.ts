/**
 * Benchmark: BullMQ Redis Client Adapter Comparison
 *
 * Compares BullMQ performance across the three built-in Redis client adapters:
 *   - ioredis    (default)
 *   - node-redis (@redis/client v5)
 *   - bun        (Bun's built-in RedisClient, Bun runtime only)
 *
 * Usage:
 *   ADAPTER=ioredis    npx tsx adapter-comparison.ts
 *   ADAPTER=node-redis npx tsx adapter-comparison.ts
 *   ADAPTER=bun        bun run adapter-comparison.ts
 *
 * Optional env vars:
 *   REDIS_HOST  (default: localhost)
 *   REDIS_PORT  (default: 6379)
 *   NUM_JOBS    (default: 50000)
 *   CONCURRENCY (default: 100)
 */

import { Queue, Worker, FlowProducer } from 'bullmq';
import type { IRedisClient } from 'bullmq';

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------
const ADAPTER = (process.env.ADAPTER || 'ioredis') as
  | 'ioredis'
  | 'node-redis'
  | 'bun';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const NUM_JOBS = Number(process.env.NUM_JOBS || 50000);
const PARALLEL_BATCH_SIZE = 1000;
const CONCURRENCY = Number(process.env.CONCURRENCY || 100);

// ----------------------------------------------------------------------------
// Runtime detection
// ----------------------------------------------------------------------------
function getRuntime(): string {
  if (typeof (globalThis as any).Bun !== 'undefined') {
    return `Bun ${(globalThis as any).Bun.version}`;
  }
  return `Node.js ${process.version}`;
}

// ----------------------------------------------------------------------------
// Connection factory
// ----------------------------------------------------------------------------
const PROTOCOL = Number(process.env.PROTOCOL || 2) as 2 | 3;

async function makeConnection(): Promise<IRedisClient> {
  if (ADAPTER === 'ioredis') {
    const { default: IORedis } = await import('ioredis');
    const { createIORedisClient } = await import('bullmq');
    const raw = new IORedis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      maxRetriesPerRequest: null,
      protocol: PROTOCOL,
    } as any);
    return createIORedisClient(raw);
  }

  if (ADAPTER === 'node-redis') {
    const { createClient } = await import('redis');
    const { createNodeRedisClient } = await import('bullmq');
    const raw = createClient({
      socket: { host: REDIS_HOST, port: REDIS_PORT },
      RESP: PROTOCOL,
    } as any);
    await raw.connect();
    return createNodeRedisClient(raw);
  }

  if (ADAPTER === 'bun') {
    if (typeof (globalThis as any).Bun === 'undefined') {
      throw new Error(
        "ADAPTER=bun requires the Bun runtime. Run with `bun run adapter-comparison.ts`.",
      );
    }
    const { RedisClient } = await import('bun');
    const { createBunRedisClient } = await import('bullmq');
    const raw = new RedisClient(`redis://${REDIS_HOST}:${REDIS_PORT}`);
    return createBunRedisClient(raw);
  }

  throw new Error(`Unknown ADAPTER: ${ADAPTER}`);
}

// ----------------------------------------------------------------------------
// Result type
// ----------------------------------------------------------------------------
interface BenchmarkResult {
  name: string;
  jobs: number;
  timeMs: number;
  rate: number;
}

function formatResult(r: BenchmarkResult): string {
  return `  ${r.name.padEnd(45)} ${r.jobs.toString().padStart(7)} jobs in ${r.timeMs
    .toString()
    .padStart(7)}ms  (${r.rate.toString().padStart(7)} jobs/sec)`;
}

// ----------------------------------------------------------------------------
// Cleanup
// ----------------------------------------------------------------------------
async function cleanup(queueName: string, connection: IRedisClient) {
  const q = new Queue(queueName, { connection });
  await q.obliterate({ force: true }).catch(() => {});
  await q.close();
}

// ============================================================================
// Benchmark 1: Job Addition (Queue.add) - Parallel batches
// ============================================================================
async function benchmarkJobAddition(
  numJobs: number,
  batchSize: number,
  connection: IRedisClient,
): Promise<BenchmarkResult> {
  const queueName = `bench-add-${Date.now()}`;
  const queue = new Queue(queueName, { connection });

  const start = Date.now();

  const numBatches = Math.ceil(numJobs / batchSize);
  for (let i = 0; i < numBatches; i++) {
    const batchStart = i * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, numJobs);
    const promises: Promise<any>[] = [];
    for (let j = batchStart; j < batchEnd; j++) {
      promises.push(queue.add('test-job', { index: j, data: 'x'.repeat(100) }));
    }
    await Promise.all(promises);
  }

  const elapsed = Date.now() - start;

  await cleanup(queueName, connection);
  await queue.close();

  return {
    name: `Job Addition (${batchSize} parallel)`,
    jobs: numJobs,
    timeMs: elapsed,
    rate: Math.round(numJobs / (elapsed / 1000)),
  };
}

// ============================================================================
// Benchmark 2: Bulk Job Addition (Queue.addBulk)
// ============================================================================
async function benchmarkBulkAddition(
  numJobs: number,
  connection: IRedisClient,
): Promise<BenchmarkResult> {
  const queueName = `bench-bulk-${Date.now()}`;
  const queue = new Queue(queueName, { connection });

  const start = Date.now();

  const chunkSize = 10000;
  for (let i = 0; i < numJobs; i += chunkSize) {
    const end = Math.min(i + chunkSize, numJobs);
    const jobs: { name: string; data: { index: number; data: string } }[] = [];
    for (let j = i; j < end; j++) {
      jobs.push({ name: 'test-job', data: { index: j, data: 'x'.repeat(100) } });
    }
    await queue.addBulk(jobs);
  }

  const elapsed = Date.now() - start;

  await cleanup(queueName, connection);
  await queue.close();

  return {
    name: 'Bulk Addition (Queue.addBulk)',
    jobs: numJobs,
    timeMs: elapsed,
    rate: Math.round(numJobs / (elapsed / 1000)),
  };
}

// ============================================================================
// Benchmark 3: Job Processing
// ============================================================================
async function benchmarkJobProcessing(
  numJobs: number,
  concurrency: number,
  connection: IRedisClient,
): Promise<BenchmarkResult> {
  const queueName = `bench-process-${Date.now()}`;
  const queue = new Queue(queueName, { connection });

  // Pre-add all jobs
  const chunkSize = 10000;
  for (let i = 0; i < numJobs; i += chunkSize) {
    const end = Math.min(i + chunkSize, numJobs);
    const jobs: { name: string; data: { index: number } }[] = [];
    for (let j = i; j < end; j++) {
      jobs.push({ name: 'test-job', data: { index: j } });
    }
    await queue.addBulk(jobs);
  }

  let processed = 0;
  const start = Date.now();

  return new Promise<BenchmarkResult>(resolve => {
    const worker = new Worker(
      queueName,
      async (job: any) => ({ processed: job.data.index }),
      { connection, concurrency },
    );

    worker.on('completed', async () => {
      processed++;
      if (processed === numJobs) {
        const elapsed = Date.now() - start;
        await worker.close();
        await cleanup(queueName, connection);
        await queue.close();
        resolve({
          name: `Job Processing (concurrency=${concurrency})`,
          jobs: numJobs,
          timeMs: elapsed,
          rate: Math.round(numJobs / (elapsed / 1000)),
        });
      }
    });
  });
}

// ============================================================================
// Benchmark 4: Processing with CPU Work
// ============================================================================
async function benchmarkJobProcessingWithWork(
  numJobs: number,
  concurrency: number,
  connection: IRedisClient,
): Promise<BenchmarkResult> {
  const queueName = `bench-work-${Date.now()}`;
  const queue = new Queue(queueName, { connection });

  const chunkSize = 10000;
  for (let i = 0; i < numJobs; i += chunkSize) {
    const end = Math.min(i + chunkSize, numJobs);
    const jobs: { name: string; data: { index: number } }[] = [];
    for (let j = i; j < end; j++) {
      jobs.push({ name: 'test-job', data: { index: j } });
    }
    await queue.addBulk(jobs);
  }

  let processed = 0;
  const start = Date.now();

  return new Promise<BenchmarkResult>(resolve => {
    const worker = new Worker(
      queueName,
      async (job: any) => {
        const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
        fib(20);
        return { processed: job.data.index };
      },
      { connection, concurrency },
    );

    worker.on('completed', async () => {
      processed++;
      if (processed === numJobs) {
        const elapsed = Date.now() - start;
        await worker.close();
        await cleanup(queueName, connection);
        await queue.close();
        resolve({
          name: `Processing with CPU Work (concurrency=${concurrency})`,
          jobs: numJobs,
          timeMs: elapsed,
          rate: Math.round(numJobs / (elapsed / 1000)),
        });
      }
    });
  });
}

// ============================================================================
// Benchmark 5: Flow Producer
// ============================================================================
async function benchmarkFlowProducer(
  numFlows: number,
  connection: IRedisClient,
): Promise<BenchmarkResult> {
  const queueName = `bench-flow-parent-${Date.now()}`;
  const childQueueName = `bench-flow-child-${Date.now()}`;
  const flowProducer = new FlowProducer({ connection });

  const start = Date.now();

  const batchSize = 500;
  for (let i = 0; i < numFlows; i += batchSize) {
    const end = Math.min(i + batchSize, numFlows);
    const promises: Promise<any>[] = [];
    for (let j = i; j < end; j++) {
      promises.push(
        flowProducer.add({
          name: 'parent-job',
          queueName,
          data: { index: j },
          children: [
            { name: 'child-1', queueName: childQueueName, data: { parent: j } },
            { name: 'child-2', queueName: childQueueName, data: { parent: j } },
          ],
        }),
      );
    }
    await Promise.all(promises);
  }

  const elapsed = Date.now() - start;

  await cleanup(queueName, connection);
  await cleanup(childQueueName, connection);
  await flowProducer.close();

  return {
    name: 'Flow Producer (parent + 2 children)',
    jobs: numFlows * 3,
    timeMs: elapsed,
    rate: Math.round((numFlows * 3) / (elapsed / 1000)),
  };
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  const runtime = getRuntime();

  console.log('═'.repeat(80));
  console.log(`BullMQ Adapter Benchmark`);
  console.log('═'.repeat(80));
  console.log(`Runtime:           ${runtime}`);
  console.log(`Adapter:           ${ADAPTER}`);
  console.log(`Redis:             ${REDIS_HOST}:${REDIS_PORT}`);
  console.log(`Jobs per test:     ${NUM_JOBS}`);
  console.log(`Parallel batch:    ${PARALLEL_BATCH_SIZE}`);
  console.log(`Worker concurrency:${CONCURRENCY}`);
  console.log('─'.repeat(80));

  const connection = await makeConnection();
  const results: BenchmarkResult[] = [];

  console.log(`\n[1/5] Job addition (${PARALLEL_BATCH_SIZE} parallel)...`);
  results.push(
    await benchmarkJobAddition(NUM_JOBS, PARALLEL_BATCH_SIZE, connection),
  );
  console.log(formatResult(results[results.length - 1]));

  console.log(`\n[2/5] Bulk addition...`);
  results.push(await benchmarkBulkAddition(NUM_JOBS, connection));
  console.log(formatResult(results[results.length - 1]));

  console.log(`\n[3/5] Job processing...`);
  results.push(await benchmarkJobProcessing(NUM_JOBS, CONCURRENCY, connection));
  console.log(formatResult(results[results.length - 1]));

  console.log(`\n[4/5] Processing with CPU work...`);
  results.push(
    await benchmarkJobProcessingWithWork(NUM_JOBS, CONCURRENCY, connection),
  );
  console.log(formatResult(results[results.length - 1]));

  console.log(`\n[5/5] Flow producer...`);
  results.push(
    await benchmarkFlowProducer(Math.floor(NUM_JOBS / 3), connection),
  );
  console.log(formatResult(results[results.length - 1]));

  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Runtime: ${runtime}   Adapter: ${ADAPTER}`);
  console.log('─'.repeat(80));
  results.forEach(r => console.log(formatResult(r)));
  console.log('═'.repeat(80));

  console.log('\nJSON Output:');
  console.log(
    JSON.stringify(
      {
        runtime,
        adapter: ADAPTER,
        timestamp: new Date().toISOString(),
        config: { numJobs: NUM_JOBS, concurrency: CONCURRENCY },
        results: results.map(r => ({
          name: r.name,
          jobs: r.jobs,
          timeMs: r.timeMs,
          rate: r.rate,
        })),
      },
      null,
      2,
    ),
  );

  await (connection as any).quit?.();
  process.exit(0);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
