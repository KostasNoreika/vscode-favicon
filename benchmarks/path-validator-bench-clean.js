/**
 * Path Validator Performance Benchmark (Clean version - no logging)
 *
 * Measures throughput and latency of path validation operations
 * to identify optimization opportunities and verify improvements.
 */

// Suppress logging for cleaner benchmark output
process.env.LOG_LEVEL = 'silent';

const { performance } = require('perf_hooks');
const { isPathAllowedAsync, sanitizePath } = require('../lib/path-validator');

// Test dataset representing realistic request patterns
const TEST_PATHS = [
    // Valid paths (70% of traffic)
    '/opt/dev/my-project',
    '/opt/dev/another-project',
    '/opt/dev/test-env',
    '/opt/prod/website',
    '/opt/prod/api-server',
    '/opt/research/ml-experiment',
    '/opt/research/data-analysis',
    '/opt/dev/microservice-a',
    '/opt/dev/microservice-b',
    '/opt/prod/frontend',

    // Invalid paths (30% of traffic - attacks and mistakes)
    '/opt/dev/../../etc/passwd',
    '/opt/devmalicious',
    '/opt/dev/../../../root',
    '/var/www/html',
    '/home/user/project',
    '/opt/dev%2f..%2f..%2fetc',
    '/opt/dev/project%00',
    '<script>alert(1)</script>',
    '/opt/dev/project$malicious',
    '',
];

/**
 * Run benchmark suite
 */
async function runBenchmark() {
    console.log('Path Validator Performance Benchmark');
    console.log('=====================================\n');

    // Warmup phase
    console.log('Warming up...');
    for (let i = 0; i < 100; i++) {
        for (const testPath of TEST_PATHS) {
            await isPathAllowedAsync(testPath);
        }
    }
    console.log('Warmup complete\n');

    // Benchmark 1: Throughput test
    console.log('Benchmark 1: Throughput Test (10,000 validations)');
    console.log('--------------------------------------------------');
    const iterations = 10000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
        const path = TEST_PATHS[i % TEST_PATHS.length];
        await isPathAllowedAsync(path);
    }

    const end = performance.now();
    const duration = end - start;
    const throughput = (iterations / duration) * 1000; // ops/sec

    console.log(`Total time: ${duration.toFixed(2)}ms`);
    console.log(`Throughput: ${throughput.toFixed(0)} validations/sec`);
    console.log(`Avg latency: ${(duration / iterations).toFixed(3)}ms per validation\n`);

    // Benchmark 2: Latency distribution (percentiles)
    console.log('Benchmark 2: Latency Distribution (1,000 samples)');
    console.log('--------------------------------------------------');
    const samples = 1000;
    const latencies = [];

    for (let i = 0; i < samples; i++) {
        const path = TEST_PATHS[i % TEST_PATHS.length];
        const start = performance.now();
        await isPathAllowedAsync(path);
        const end = performance.now();
        latencies.push(end - start);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(samples * 0.50)];
    const p90 = latencies[Math.floor(samples * 0.90)];
    const p95 = latencies[Math.floor(samples * 0.95)];
    const p99 = latencies[Math.floor(samples * 0.99)];
    const min = latencies[0];
    const max = latencies[samples - 1];

    console.log(`Min:  ${min.toFixed(3)}ms`);
    console.log(`p50:  ${p50.toFixed(3)}ms`);
    console.log(`p90:  ${p90.toFixed(3)}ms`);
    console.log(`p95:  ${p95.toFixed(3)}ms`);
    console.log(`p99:  ${p99.toFixed(3)}ms`);
    console.log(`Max:  ${max.toFixed(3)}ms\n`);

    // Benchmark 3: Hot path analysis (cached vs uncached)
    console.log('Benchmark 3: Cache Hit Analysis');
    console.log('--------------------------------------------------');

    // Clear module cache to get fresh instance
    delete require.cache[require.resolve('../lib/path-validator')];
    const { isPathAllowedAsync: freshValidator } = require('../lib/path-validator');

    // First request (cache miss)
    const testPath = '/opt/dev/cache-test-' + Date.now();
    const miss1 = performance.now();
    await freshValidator(testPath);
    const miss2 = performance.now();
    const cacheMissLatency = miss2 - miss1;

    // Second request (cache hit)
    const hit1 = performance.now();
    await freshValidator(testPath);
    const hit2 = performance.now();
    const cacheHitLatency = hit2 - hit1;

    console.log(`Cache miss latency: ${cacheMissLatency.toFixed(3)}ms`);
    console.log(`Cache hit latency:  ${cacheHitLatency.toFixed(3)}ms`);
    console.log(`Speedup: ${(cacheMissLatency / cacheHitLatency).toFixed(1)}x\n`);

    // Benchmark 4: Sanitization overhead
    console.log('Benchmark 4: Sanitization Performance');
    console.log('--------------------------------------------------');
    const sanitizeSamples = 100000;
    const sanitizeStart = performance.now();

    for (let i = 0; i < sanitizeSamples; i++) {
        const path = TEST_PATHS[i % TEST_PATHS.length];
        sanitizePath(path);
    }

    const sanitizeEnd = performance.now();
    const sanitizeDuration = sanitizeEnd - sanitizeStart;
    const sanitizeThroughput = (sanitizeSamples / sanitizeDuration) * 1000;

    console.log(`Total time: ${sanitizeDuration.toFixed(2)}ms`);
    console.log(`Throughput: ${sanitizeThroughput.toFixed(0)} sanitizations/sec`);
    console.log(`Avg latency: ${(sanitizeDuration / sanitizeSamples).toFixed(3)}ms\n`);

    // Benchmark 5: Pattern-specific performance
    console.log('Benchmark 5: Pattern-Specific Performance');
    console.log('--------------------------------------------------');

    const patterns = {
        'Valid allowed path': '/opt/dev/my-project',
        'Directory traversal': '/opt/dev/../../etc/passwd',
        'Prefix confusion': '/opt/devmalicious',
        'URL encoded attack': '/opt/dev%2f..%2f..%2fetc',
        'Null byte injection': '/opt/dev/test%00',
        'Outside allowed paths': '/var/www/html',
    };

    for (const [name, path] of Object.entries(patterns)) {
        const iterations = 1000;
        const start = performance.now();

        for (let i = 0; i < iterations; i++) {
            await isPathAllowedAsync(path);
        }

        const end = performance.now();
        const avgLatency = (end - start) / iterations;
        console.log(`${name.padEnd(25)}: ${avgLatency.toFixed(3)}ms`);
    }

    console.log('\nBenchmark complete!');
}

// Run the benchmark
runBenchmark().catch(console.error);
