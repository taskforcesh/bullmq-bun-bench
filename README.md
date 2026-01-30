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

## Environment Variables

- `REDIS_HOST` - Redis host (default: `localhost`)

## License

MIT
