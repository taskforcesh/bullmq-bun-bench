# BullMQ Runtime Benchmark

Benchmark comparing BullMQ performance on **Node.js** vs **Bun** runtimes.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+ 
- [Bun](https://bun.sh/) v1.0+
- Redis server running on localhost (or set `REDIS_HOST` env var)

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

## Sample Results

### Node.js v24.13.0
```
Add Jobs:    38,462 jobs/sec
Bulk Add:    37,879 jobs/sec
Processing:  24,390 jobs/sec
Flows:       25,896 jobs/sec
```

### Bun 1.3.3
```
Add Jobs:    45,872 jobs/sec
Bulk Add:    45,872 jobs/sec
Processing:  21,008 jobs/sec
Flows:       17,415 jobs/sec
```

## Key Findings

| Benchmark | Winner | Difference |
|-----------|--------|------------|
| Job Addition | 🏆 Bun | ~20% faster |
| Bulk Addition | 🏆 Bun | ~21% faster |
| Job Processing | 🏆 Node.js | ~16% faster |
| CPU-intensive Work | 🏆 Bun | ~59% faster |
| Flow Producer | varies | depends on run |

### Summary

- **Bun excels** at queue operations (add/addBulk) and CPU-intensive work
- **Node.js** can be faster for I/O-heavy worker processing
- Both runtimes work well with BullMQ — choose based on your workload

## Environment Variables

- `REDIS_HOST` - Redis host (default: `localhost`)

## License

MIT
