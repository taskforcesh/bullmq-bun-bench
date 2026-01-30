/**
 * Benchmark: Node.js vs Bun Runtime Comparison
 * 
 * Compares BullMQ performance across different JavaScript runtimes.
 * 
 * Run with Node.js:
 *   npx tsx runtime-comparison.ts
 * 
 * Run with Bun:
 *   bun run runtime-comparison.ts
 */

import { Queue, Worker, FlowProducer } from 'bullmq';
import IORedis from 'ioredis';

// Configuration
const NUM_JOBS_ADD = 100000;       // For add/bulk benchmarks
const NUM_JOBS_PROCESS = 100000;   // For processing benchmarks
const PARALLEL_BATCH_SIZE = 1000;  // Add jobs in parallel batches of this size
const CONCURRENCY = 100;

// Detect runtime
function getRuntime(): string {
  if (typeof (globalThis as any).Bun !== 'undefined') {
    return `Bun ${(globalThis as any).Bun.version}`;
  }
  if (typeof (globalThis as any).Deno !== 'undefined') {
    return `Deno ${(globalThis as any).Deno.version.deno}`;
  }
  return `Node.js ${process.version}`;
}

// Shared connection
const connection = new IORedis({ 
  maxRetriesPerRequest: null,
  host: process.env.REDIS_HOST || 'localhost',
});

interface BenchmarkResult {
  name: string;
  jobs: number;
  timeMs: number;
  rate: number;  // jobs per second
}

async function cleanup(queueName: string) {
  const keys = await connection.keys(`bull:${queueName}:*`);
  if (keys.length > 0) {
    // Delete in chunks to avoid stack overflow with many keys
    const chunkSize = 1000;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      await connection.del(...chunk);
    }
  }
}

// ============================================================================
// Benchmark 1: Job Addition (Queue.add) - Parallel batches
// ============================================================================
async function benchmarkJobAddition(numJobs: number, batchSize: number): Promise<BenchmarkResult> {
  const queueName = `bench-add-${Date.now()}`;
  const queue = new Queue(queueName, { connection });
  
  await cleanup(queueName);
  
  const start = Date.now();
  
  // Add jobs in parallel batches
  const numBatches = Math.ceil(numJobs / batchSize);
  for (let i = 0; i < numBatches; i++) {
    const batchStart = i * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, numJobs);
    const currentBatchSize = batchEnd - batchStart;
    
    const promises: Promise<any>[] = [];
    for (let j = 0; j < currentBatchSize; j++) {
      promises.push(queue.add('test-job', { index: batchStart + j, data: 'x'.repeat(100) }));
    }
    await Promise.all(promises);
  }
  
  const elapsed = Date.now() - start;
  
  await cleanup(queueName);
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
async function benchmarkBulkAddition(numJobs: number): Promise<BenchmarkResult> {
  const queueName = `bench-bulk-${Date.now()}`;
  const queue = new Queue(queueName, { connection });
  
  await cleanup(queueName);
  
  const start = Date.now();
  
  // Add in chunks to avoid memory issues with huge arrays
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
  
  await cleanup(queueName);
  await queue.close();
  
  return {
    name: 'Bulk Addition (Queue.addBulk)',
    jobs: numJobs,
    timeMs: elapsed,
    rate: Math.round(numJobs / (elapsed / 1000)),
  };
}

// ============================================================================
// Benchmark 3: Job Processing (Worker)
// ============================================================================
async function benchmarkJobProcessing(numJobs: number, concurrency: number): Promise<BenchmarkResult> {
  const queueName = `bench-process-${Date.now()}`;
  const queue = new Queue(queueName, { connection });
  
  await cleanup(queueName);
  
  // Pre-add all jobs
  const jobs = Array.from({ length: numJobs }, (_, i) => ({
    name: 'test-job',
    data: { index: i },
  }));
  await queue.addBulk(jobs);
  
  let processed = 0;
  const start = Date.now();
  
  return new Promise<BenchmarkResult>((resolve) => {
    const worker = new Worker(
      queueName,
      async (job: any) => {
        // Simulate minimal work
        return { processed: job.data.index };
      },
      { connection, concurrency }
    );
    
    worker.on('completed', async () => {
      processed++;
      if (processed === numJobs) {
        const elapsed = Date.now() - start;
        await worker.close();
        await cleanup(queueName);
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
// Benchmark 4: Job Processing with CPU Work
// ============================================================================
async function benchmarkJobProcessingWithWork(numJobs: number, concurrency: number): Promise<BenchmarkResult> {
  const queueName = `bench-work-${Date.now()}`;
  const queue = new Queue(queueName, { connection });
  
  await cleanup(queueName);
  
  // Pre-add all jobs
  const jobs = Array.from({ length: numJobs }, (_, i) => ({
    name: 'test-job',
    data: { index: i },
  }));
  await queue.addBulk(jobs);
  
  let processed = 0;
  const start = Date.now();
  
  return new Promise<BenchmarkResult>((resolve) => {
    const worker = new Worker(
      queueName,
      async (job: any) => {
        // Simulate some CPU work (fibonacci)
        const fib = (n: number): number => n <= 1 ? n : fib(n - 1) + fib(n - 2);
        fib(20);
        return { processed: job.data.index };
      },
      { connection, concurrency }
    );
    
    worker.on('completed', async () => {
      processed++;
      if (processed === numJobs) {
        const elapsed = Date.now() - start;
        await worker.close();
        await cleanup(queueName);
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
async function benchmarkFlowProducer(numFlows: number): Promise<BenchmarkResult> {
  const queueName = `bench-flow-${Date.now()}`;
  const childQueueName = `bench-flow-child-${Date.now()}`;
  const flowProducer = new FlowProducer({ connection });
  
  await cleanup(queueName);
  await cleanup(childQueueName);
  
  const start = Date.now();
  
  const promises = [];
  for (let i = 0; i < numFlows; i++) {
    promises.push(
      flowProducer.add({
        name: 'parent-job',
        queueName,
        data: { index: i },
        children: [
          { name: 'child-1', queueName: childQueueName, data: { parent: i } },
          { name: 'child-2', queueName: childQueueName, data: { parent: i } },
        ],
      })
    );
  }
  await Promise.all(promises);
  
  const elapsed = Date.now() - start;
  
  await cleanup(queueName);
  await cleanup(childQueueName);
  await flowProducer.close();
  
  return {
    name: 'Flow Producer (parent + 2 children)',
    jobs: numFlows * 3,  // 1 parent + 2 children per flow
    timeMs: elapsed,
    rate: Math.round((numFlows * 3) / (elapsed / 1000)),
  };
}

// ============================================================================
// Main
// ============================================================================
function formatResult(result: BenchmarkResult): string {
  return `  ${result.name.padEnd(45)} ${result.jobs.toString().padStart(6)} jobs in ${result.timeMs.toString().padStart(6)}ms  (${result.rate.toString().padStart(6)} jobs/sec)`;
}

async function main() {
  const runtime = getRuntime();
  
  console.log('═'.repeat(80));
  console.log(`BullMQ Runtime Benchmark - ${runtime}`);
  console.log('═'.repeat(80));
  console.log(`Jobs for add/bulk: ${NUM_JOBS_ADD}`);
  console.log(`Jobs for processing: ${NUM_JOBS_PROCESS}`);
  console.log(`Parallel batch size: ${PARALLEL_BATCH_SIZE}`);
  console.log(`Worker concurrency: ${CONCURRENCY}`);
  console.log('─'.repeat(80));
  
  const results: BenchmarkResult[] = [];
  
  console.log(`\n[1/5] Benchmarking job addition (${PARALLEL_BATCH_SIZE} parallel)...`);
  results.push(await benchmarkJobAddition(NUM_JOBS_ADD, PARALLEL_BATCH_SIZE));
  console.log(formatResult(results[results.length - 1]));
  
  console.log(`\n[2/5] Benchmarking bulk addition...`);
  results.push(await benchmarkBulkAddition(NUM_JOBS_ADD));
  console.log(formatResult(results[results.length - 1]));
  
  console.log('\n[3/5] Benchmarking job processing...');
  results.push(await benchmarkJobProcessing(NUM_JOBS_PROCESS, CONCURRENCY));
  console.log(formatResult(results[results.length - 1]));
  
  console.log('\n[4/5] Benchmarking processing with CPU work...');
  results.push(await benchmarkJobProcessingWithWork(NUM_JOBS_PROCESS, CONCURRENCY));
  console.log(formatResult(results[results.length - 1]));
  
  console.log('\n[5/5] Benchmarking flow producer...');
  results.push(await benchmarkFlowProducer(Math.floor(NUM_JOBS_PROCESS / 3)));
  console.log(formatResult(results[results.length - 1]));
  
  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Runtime: ${runtime}`);
  console.log('─'.repeat(80));
  results.forEach(r => console.log(formatResult(r)));
  console.log('═'.repeat(80));
  
  // Output JSON for easy comparison
  console.log('\nJSON Output (for comparison):');
  console.log(JSON.stringify({
    runtime,
    timestamp: new Date().toISOString(),
    config: { numJobsAdd: NUM_JOBS_ADD, numJobsProcess: NUM_JOBS_PROCESS, concurrency: CONCURRENCY },
    results: results.map(r => ({
      name: r.name,
      jobs: r.jobs,
      timeMs: r.timeMs,
      rate: r.rate,
    })),
  }, null, 2));
  
  await connection.quit();
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
