import { Queue, Worker, FlowProducer } from 'bullmq';
import IORedis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const connection = new IORedis(redisHost, { maxRetriesPerRequest: null });

// Detect runtime
const runtime = typeof Bun !== 'undefined' ? 'Bun' : 'Node.js';
const runtimeVersion = typeof Bun !== 'undefined' ? Bun.version : process.version;

console.log(`\n🚀 BullMQ Benchmark - ${runtime} ${runtimeVersion}\n`);
console.log('='.repeat(50));

// Utility functions
function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function cleanQueue(queueName) {
  const q = new Queue(queueName, { connection });
  await q.obliterate({ force: true });
  await q.close();
}

// Benchmark: Adding jobs
async function benchmarkAddJobs(count) {
  const queueName = `bench-add-${Date.now()}`;
  const queue = new Queue(queueName, { connection });
  
  const start = performance.now();
  
  for (let i = 0; i < count; i++) {
    await queue.add('test-job', { index: i, data: 'x'.repeat(100) });
  }
  
  const duration = performance.now() - start;
  const jobsPerSecond = (count / duration) * 1000;
  
  await queue.obliterate({ force: true });
  await queue.close();
  
  return { duration, jobsPerSecond, count };
}

// Benchmark: Bulk adding jobs
async function benchmarkBulkAdd(count) {
  const queueName = `bench-bulk-${Date.now()}`;
  const queue = new Queue(queueName, { connection });
  
  const jobs = Array.from({ length: count }, (_, i) => ({
    name: 'test-job',
    data: { index: i, data: 'x'.repeat(100) },
  }));
  
  const start = performance.now();
  await queue.addBulk(jobs);
  const duration = performance.now() - start;
  
  const jobsPerSecond = (count / duration) * 1000;
  
  await queue.obliterate({ force: true });
  await queue.close();
  
  return { duration, jobsPerSecond, count };
}

// Benchmark: Processing jobs
async function benchmarkProcessing(count) {
  const queueName = `bench-process-${Date.now()}`;
  const queue = new Queue(queueName, { connection });
  
  // Add jobs first
  const jobs = Array.from({ length: count }, (_, i) => ({
    name: 'test-job',
    data: { index: i },
  }));
  await queue.addBulk(jobs);
  
  let processed = 0;
  const start = performance.now();
  
  return new Promise(async (resolve) => {
    const worker = new Worker(
      queueName,
      async (job) => {
        // Simulate minimal work
        return { done: true };
      },
      { connection, concurrency: 10 }
    );
    
    worker.on('completed', async () => {
      processed++;
      if (processed >= count) {
        const duration = performance.now() - start;
        const jobsPerSecond = (count / duration) * 1000;
        
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
        
        resolve({ duration, jobsPerSecond, count });
      }
    });
  });
}

// Benchmark: Flow producer
async function benchmarkFlows(count) {
  const parentQueueName = `bench-flow-parent-${Date.now()}`;
  const childQueueName = `bench-flow-child-${Date.now()}`;
  const flowProducer = new FlowProducer({ connection });
  
  const start = performance.now();
  
  for (let i = 0; i < count; i++) {
    await flowProducer.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: { index: i },
      children: [
        { name: 'child-1', queueName: childQueueName, data: { child: 1 } },
        { name: 'child-2', queueName: childQueueName, data: { child: 2 } },
      ],
    });
  }
  
  const duration = performance.now() - start;
  const flowsPerSecond = (count / duration) * 1000;
  
  // Cleanup
  await cleanQueue(parentQueueName);
  await cleanQueue(childQueueName);
  await flowProducer.close();
  
  return { duration, flowsPerSecond, count };
}

// Run all benchmarks
async function runBenchmarks() {
  const results = {};
  
  // 1. Add jobs individually
  console.log('\n📝 Benchmark: Adding jobs individually (1000 jobs)');
  const addResult = await benchmarkAddJobs(1000);
  console.log(`   Duration: ${formatDuration(addResult.duration)}`);
  console.log(`   Throughput: ${formatNumber(addResult.jobsPerSecond)} jobs/sec`);
  results.addJobs = addResult;
  
  // 2. Bulk add jobs
  console.log('\n📦 Benchmark: Bulk adding jobs (5000 jobs)');
  const bulkResult = await benchmarkBulkAdd(5000);
  console.log(`   Duration: ${formatDuration(bulkResult.duration)}`);
  console.log(`   Throughput: ${formatNumber(bulkResult.jobsPerSecond)} jobs/sec`);
  results.bulkAdd = bulkResult;
  
  // 3. Processing jobs
  console.log('\n⚙️  Benchmark: Processing jobs (1000 jobs, concurrency=10)');
  const processResult = await benchmarkProcessing(1000);
  console.log(`   Duration: ${formatDuration(processResult.duration)}`);
  console.log(`   Throughput: ${formatNumber(processResult.jobsPerSecond)} jobs/sec`);
  results.processing = processResult;
  
  // 4. Flow producer
  console.log('\n🌊 Benchmark: Creating flows (100 flows with 2 children each)');
  const flowResult = await benchmarkFlows(100);
  console.log(`   Duration: ${formatDuration(flowResult.duration)}`);
  console.log(`   Throughput: ${formatNumber(flowResult.flowsPerSecond)} flows/sec`);
  results.flows = flowResult;
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Summary for ${runtime} ${runtimeVersion}`);
  console.log('='.repeat(50));
  console.log(`Add Jobs:    ${formatNumber(results.addJobs.jobsPerSecond)} jobs/sec`);
  console.log(`Bulk Add:    ${formatNumber(results.bulkAdd.jobsPerSecond)} jobs/sec`);
  console.log(`Processing:  ${formatNumber(results.processing.jobsPerSecond)} jobs/sec`);
  console.log(`Flows:       ${formatNumber(results.flows.flowsPerSecond)} flows/sec`);
  
  await connection.quit();
  
  return results;
}

runBenchmarks()
  .then(() => {
    console.log('\n✅ Benchmark completed successfully\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
