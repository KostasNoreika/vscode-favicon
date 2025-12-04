/**
 * Concurrent Benchmark - Real World Load Test
 * Tests async vs blocking under concurrent load
 * This demonstrates the TRUE value of async I/O
 */

const http = require('http');
const { performance } = require('perf_hooks');

// Simulate blocking server
function createBlockingServer(port) {
    const server = http.createServer((req, res) => {
        const start = performance.now();

        // Simulate blocking I/O (like fs.readFileSync)
        const blockTime = 5; // 5ms blocking per request
        const end = Date.now() + blockTime;
        while (Date.now() < end) {
            // Busy wait (blocking)
        }

        res.writeHead(200);
        res.end(
            JSON.stringify({
                type: 'blocking',
                duration: performance.now() - start,
            })
        );
    });

    return new Promise((resolve) => {
        server.listen(port, () => resolve(server));
    });
}

// Simulate async server
function createAsyncServer(port) {
    const server = http.createServer(async (req, res) => {
        const start = performance.now();

        // Simulate async I/O (like fs.promises.readFile)
        await new Promise((resolve) => setTimeout(resolve, 5));

        res.writeHead(200);
        res.end(
            JSON.stringify({
                type: 'async',
                duration: performance.now() - start,
            })
        );
    });

    return new Promise((resolve) => {
        server.listen(port, () => resolve(server));
    });
}

// Make HTTP request
function makeRequest(port) {
    return new Promise((resolve, reject) => {
        const start = performance.now();

        const req = http.get(`http://localhost:${port}`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                const duration = performance.now() - start;
                resolve({ duration, status: res.statusCode, data });
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => reject(new Error('Timeout')));
    });
}

// Load test function
async function loadTest(port, concurrentRequests, totalRequests) {
    const results = [];
    let completed = 0;

    const startTime = performance.now();

    // Create batches of concurrent requests
    while (completed < totalRequests) {
        const batch = Math.min(concurrentRequests, totalRequests - completed);
        const promises = [];

        for (let i = 0; i < batch; i++) {
            promises.push(
                makeRequest(port)
                    .then((result) => {
                        results.push(result.duration);
                        completed++;
                    })
                    .catch((err) => {
                        console.error('Request failed:', err.message);
                        completed++;
                    })
            );
        }

        await Promise.all(promises);
    }

    const totalTime = performance.now() - startTime;

    // Calculate statistics
    results.sort((a, b) => a - b);
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    const min = results[0];
    const max = results[results.length - 1];
    const p50 = results[Math.floor(results.length * 0.5)];
    const p95 = results[Math.floor(results.length * 0.95)];
    const p99 = results[Math.floor(results.length * 0.99)];
    const throughput = (totalRequests / (totalTime / 1000)).toFixed(2);

    return {
        totalTime: totalTime.toFixed(2),
        throughput,
        latency: {
            avg: avg.toFixed(2),
            min: min.toFixed(2),
            max: max.toFixed(2),
            p50: p50.toFixed(2),
            p95: p95.toFixed(2),
            p99: p99.toFixed(2),
        },
    };
}

// Main benchmark
async function benchmark() {
    console.log('='.repeat(70));
    console.log('CONCURRENT LOAD TEST: Blocking vs Async I/O');
    console.log('='.repeat(70));
    console.log();
    console.log('This simulates REAL production load with multiple concurrent users');
    console.log('Each request does 5ms of I/O (simulating file reads)');
    console.log();

    const BLOCKING_PORT = 9901;
    const ASYNC_PORT = 9902;

    // Start servers
    console.log('Starting test servers...');
    const blockingServer = await createBlockingServer(BLOCKING_PORT);
    const asyncServer = await createAsyncServer(ASYNC_PORT);
    console.log('✓ Servers started');
    console.log();

    // Test scenarios
    const scenarios = [
        { concurrent: 10, total: 100, name: 'Light Load (10 concurrent)' },
        { concurrent: 50, total: 500, name: 'Medium Load (50 concurrent)' },
        { concurrent: 100, total: 1000, name: 'Heavy Load (100 concurrent)' },
    ];

    for (const scenario of scenarios) {
        console.log('='.repeat(70));
        console.log(`Scenario: ${scenario.name}`);
        console.log(`Total Requests: ${scenario.total}, Concurrent: ${scenario.concurrent}`);
        console.log('-'.repeat(70));

        // Test blocking server
        console.log('Testing BLOCKING server...');
        const blockingResults = await loadTest(BLOCKING_PORT, scenario.concurrent, scenario.total);

        // Wait a bit between tests
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Test async server
        console.log('Testing ASYNC server...');
        const asyncResults = await loadTest(ASYNC_PORT, scenario.concurrent, scenario.total);

        // Display results
        console.log();
        console.log('RESULTS:');
        console.log('-'.repeat(70));
        console.log('                     BLOCKING          ASYNC          IMPROVEMENT');
        console.log('-'.repeat(70));
        console.log(
            `Total Time:          ${blockingResults.totalTime.padEnd(16)} ${asyncResults.totalTime.padEnd(14)} ${(100 - (parseFloat(asyncResults.totalTime) / parseFloat(blockingResults.totalTime)) * 100).toFixed(1)}% faster`
        );
        console.log(
            `Throughput (req/s):  ${blockingResults.throughput.padEnd(16)} ${asyncResults.throughput.padEnd(14)} ${((parseFloat(asyncResults.throughput) / parseFloat(blockingResults.throughput)) * 100 - 100).toFixed(1)}% higher`
        );
        console.log();
        console.log('Latency (ms):');
        console.log(
            `  Average:           ${blockingResults.latency.avg.padEnd(16)} ${asyncResults.latency.avg.padEnd(14)} ${(100 - (parseFloat(asyncResults.latency.avg) / parseFloat(blockingResults.latency.avg)) * 100).toFixed(1)}% faster`
        );
        console.log(
            `  Median (P50):      ${blockingResults.latency.p50.padEnd(16)} ${asyncResults.latency.p50.padEnd(14)} ${(100 - (parseFloat(asyncResults.latency.p50) / parseFloat(blockingResults.latency.p50)) * 100).toFixed(1)}% faster`
        );
        console.log(
            `  P95:               ${blockingResults.latency.p95.padEnd(16)} ${asyncResults.latency.p95.padEnd(14)} ${(100 - (parseFloat(asyncResults.latency.p95) / parseFloat(blockingResults.latency.p95)) * 100).toFixed(1)}% faster`
        );
        console.log(
            `  P99:               ${blockingResults.latency.p99.padEnd(16)} ${asyncResults.latency.p99.padEnd(14)} ${(100 - (parseFloat(asyncResults.latency.p99) / parseFloat(blockingResults.latency.p99)) * 100).toFixed(1)}% faster`
        );
        console.log(
            `  Min:               ${blockingResults.latency.min.padEnd(16)} ${asyncResults.latency.min}`
        );
        console.log(
            `  Max:               ${blockingResults.latency.max.padEnd(16)} ${asyncResults.latency.max}`
        );
        console.log();
    }

    // Cleanup
    blockingServer.close();
    asyncServer.close();

    console.log('='.repeat(70));
    console.log('KEY INSIGHTS:');
    console.log('='.repeat(70));
    console.log('1. Under concurrent load, async I/O dramatically improves throughput');
    console.log('2. Blocking I/O causes request queueing, leading to high P95/P99 latencies');
    console.log('3. Async allows Node.js event loop to handle multiple requests in parallel');
    console.log('4. The higher the concurrency, the bigger the async advantage');
    console.log();
    console.log('CONCLUSION:');
    console.log('While single-request latency may be similar, async I/O is CRITICAL for');
    console.log('production systems handling multiple concurrent users. It prevents the');
    console.log('event loop from blocking and enables true concurrency.');
    console.log('='.repeat(70));
}

// Run benchmark
benchmark().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
