/**
 * Performance Benchmark - Async vs Sync I/O
 * Measures the impact of converting blocking I/O to async operations
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const config = require('../lib/config');

// Simulated blocking version for comparison
function loadProjectRegistrySync() {
    const data = fs.readFileSync(config.registryPath, 'utf8');
    const registry = JSON.parse(data);
    const flatProjects = {};

    if (registry.projects?.development) {
        registry.projects.development.forEach((project) => {
            flatProjects[project.path] = project;
        });
    }

    if (registry.projects?.production) {
        registry.projects.production.forEach((project) => {
            flatProjects[project.path] = { ...project, type: 'prod' };
        });
    }

    return flatProjects;
}

// Async version
async function loadProjectRegistryAsync() {
    const data = await fs.promises.readFile(config.registryPath, 'utf8');
    const registry = JSON.parse(data);
    const flatProjects = {};

    if (registry.projects?.development) {
        registry.projects.development.forEach((project) => {
            flatProjects[project.path] = project;
        });
    }

    if (registry.projects?.production) {
        registry.projects.production.forEach((project) => {
            flatProjects[project.path] = { ...project, type: 'prod' };
        });
    }

    return flatProjects;
}

// Simulated blocking favicon search
function findProjectFaviconSync(projectPath) {
    const possiblePaths = [];

    for (const faviconPath of config.faviconSearchPaths) {
        possiblePaths.push(path.join(projectPath, faviconPath));
    }

    for (const pattern of config.faviconImagePatterns) {
        for (const dir of config.faviconImageDirs) {
            possiblePaths.push(path.join(projectPath, dir, pattern));
        }
    }

    // Sequential checks (blocking)
    for (const fullPath of possiblePaths) {
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}

// Async parallel favicon search
async function findProjectFaviconAsync(projectPath) {
    const possiblePaths = [];

    for (const faviconPath of config.faviconSearchPaths) {
        possiblePaths.push(path.join(projectPath, faviconPath));
    }

    for (const pattern of config.faviconImagePatterns) {
        for (const dir of config.faviconImageDirs) {
            possiblePaths.push(path.join(projectPath, dir, pattern));
        }
    }

    // Parallel checks (non-blocking)
    const checks = possiblePaths.map(async (fullPath) => {
        try {
            await fs.promises.access(fullPath, fs.constants.R_OK);
            return fullPath;
        } catch {
            return null;
        }
    });

    const results = await Promise.all(checks);
    return results.find((r) => r !== null) || null;
}

// Benchmark function
async function benchmark() {
    console.log('='.repeat(60));
    console.log('PERFORMANCE BENCHMARK: Blocking vs Async I/O');
    console.log('='.repeat(60));
    console.log();

    const iterations = 100;
    const testPath = '/opt/dev/test-project';

    // Warm up
    for (let i = 0; i < 5; i++) {
        loadProjectRegistrySync();
        await loadProjectRegistryAsync();
    }

    // Benchmark 1: Registry Loading
    console.log('Test 1: Project Registry Loading');
    console.log('-'.repeat(60));

    const syncRegistryStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        loadProjectRegistrySync();
    }
    const syncRegistryTime = performance.now() - syncRegistryStart;

    const asyncRegistryStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        await loadProjectRegistryAsync();
    }
    const asyncRegistryTime = performance.now() - asyncRegistryStart;

    console.log(
        `Sync:  ${syncRegistryTime.toFixed(2)}ms (${(syncRegistryTime / iterations).toFixed(2)}ms per call)`
    );
    console.log(
        `Async: ${asyncRegistryTime.toFixed(2)}ms (${(asyncRegistryTime / iterations).toFixed(2)}ms per call)`
    );
    console.log(`Speedup: ${(syncRegistryTime / asyncRegistryTime).toFixed(2)}x`);
    console.log();

    // Benchmark 2: Favicon Search (35+ file existence checks)
    console.log('Test 2: Favicon Search (35+ file checks)');
    console.log('-'.repeat(60));

    const syncFaviconStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        findProjectFaviconSync(testPath);
    }
    const syncFaviconTime = performance.now() - syncFaviconStart;

    const asyncFaviconStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        await findProjectFaviconAsync(testPath);
    }
    const asyncFaviconTime = performance.now() - asyncFaviconStart;

    console.log(
        `Sync:  ${syncFaviconTime.toFixed(2)}ms (${(syncFaviconTime / iterations).toFixed(2)}ms per call)`
    );
    console.log(
        `Async: ${asyncFaviconTime.toFixed(2)}ms (${(asyncFaviconTime / iterations).toFixed(2)}ms per call)`
    );
    console.log(`Speedup: ${(syncFaviconTime / asyncFaviconTime).toFixed(2)}x`);
    console.log();

    // Benchmark 3: Combined (Full Request Simulation)
    console.log('Test 3: Full Request Simulation (Registry + Favicon)');
    console.log('-'.repeat(60));

    const syncFullStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        loadProjectRegistrySync();
        findProjectFaviconSync(testPath);
    }
    const syncFullTime = performance.now() - syncFullStart;

    const asyncFullStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        await loadProjectRegistryAsync();
        await findProjectFaviconAsync(testPath);
    }
    const asyncFullTime = performance.now() - asyncFullStart;

    console.log(
        `Sync:  ${syncFullTime.toFixed(2)}ms (${(syncFullTime / iterations).toFixed(2)}ms per request)`
    );
    console.log(
        `Async: ${asyncFullTime.toFixed(2)}ms (${(asyncFullTime / iterations).toFixed(2)}ms per request)`
    );
    console.log(`Speedup: ${(syncFullTime / asyncFullTime).toFixed(2)}x`);
    console.log();

    // Summary
    console.log('='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total blocking time eliminated: ${(syncFullTime - asyncFullTime).toFixed(2)}ms`);
    console.log(
        `Average per-request improvement: ${((syncFullTime - asyncFullTime) / iterations).toFixed(2)}ms`
    );
    console.log();
    console.log('Target: <50ms response time');
    console.log(`Before: ${(syncFullTime / iterations).toFixed(2)}ms per request`);
    console.log(`After:  ${(asyncFullTime / iterations).toFixed(2)}ms per request`);
    console.log();

    if (asyncFullTime / iterations < 50) {
        console.log('✓ TARGET ACHIEVED: Response time is under 50ms!');
    } else {
        console.log('✗ TARGET NOT MET: Response time exceeds 50ms');
    }
    console.log('='.repeat(60));
}

// Run benchmark
benchmark().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
