const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const logger = require('../logger');

// Favicon file patterns to search for (priority order)
const FAVICON_PATTERNS = [
    'favicon.ico',
    'favicon.png',
    'favicon.svg',
    'icon.png',
    'icon.ico',
    'logo.png',
    'logo.svg',
];

// Common directories to check first (fast path)
const COMMON_PATHS = [
    '', // root
    'public',
    'static',
    'assets',
    'frontend/public',
    'client/public',
    'src/assets',
    'web',
    'www',
    'images',
    'img',
    // Python/Flask/Django projects
    'app/static',
    'app/assets',
    'src/static',
];

// Directories to ignore during full scan
const IGNORE_DIRS = [
    'node_modules',
    '.git',
    'vendor',
    '.next',
    '.nuxt',
    'dist',
    'build',
    'coverage',
    '.cache',
    '__pycache__',
    '.pytest_cache',
    'venv',
    '.venv',
    'target',
];

// FIX QUA-011: Scan limits to prevent memory leaks
const SCAN_LIMITS = {
    MAX_RESULTS: 1000, // Maximum file results to process
    MAX_DIRECTORIES: 50, // Maximum unique directories to scan
    TIMEOUT_MS: 5000, // 5 second timeout for deep scans
};

/**
 * FaviconFinder - Responsible for locating custom favicon files
 *
 * Separates file search concerns from generation and caching.
 * Uses two-phase search: quick check in common locations, then deep scan.
 */
class FaviconFinder {
    /**
     * Find favicon file in project directory
     *
     * @param {string} projectPath - Project directory path
     * @returns {Promise<string|null>} Path to favicon file or null
     */
    async findFaviconFile(projectPath) {
        // First try quick search in common locations
        const quickResult = await this.quickSearch(projectPath);
        if (quickResult) return quickResult;

        // Fall back to full project scan
        return await this.fullProjectScan(projectPath);
    }

    /**
     * PERF-004: Quick search with parallel checking for each priority level
     * Check all paths for each pattern in parallel, maintaining priority order
     *
     * @param {string} projectPath - Project directory path
     * @returns {Promise<string|null>} Path to favicon file or null
     */
    async quickSearch(projectPath) {
        try {
            // Check each pattern in priority order
            for (const pattern of FAVICON_PATTERNS) {
                // Build all path candidates for this pattern
                const pathCandidates = COMMON_PATHS.map((dir) =>
                    path.join(projectPath, dir, pattern)
                );

                // Check all candidates in parallel
                const results = await Promise.all(
                    pathCandidates.map(async (fullPath) => {
                        try {
                            await fs.promises.access(fullPath, fs.constants.R_OK);
                            return fullPath; // Found and readable
                        } catch {
                            return null; // Not found or not readable
                        }
                    })
                );

                // Return first successful result for this pattern
                const found = results.find((result) => result !== null);
                if (found) {
                    return found;
                }
            }

            return null;
        } catch (err) {
            logger.warn({ err, projectPath }, 'Favicon quick search failed');
            return null;
        }
    }

    /**
     * FIX QUA-011: Full project scan with limits and timeout protection
     * PERF-002: Single-pass min-finding instead of sorting entire array
     *
     * Implements safeguards:
     * - 5 second timeout via AbortController
     * - Max 1000 file results
     * - Max 50 unique directories
     * - Logs when limits are hit
     *
     * @param {string} projectPath - Project directory path
     * @returns {Promise<string|null>} Path to favicon file or null
     */
    async fullProjectScan(projectPath) {
        const patterns = FAVICON_PATTERNS.map((p) => `**/${p}`);
        const abortController = new AbortController();
        let timeoutId = null;
        let limitHit = false;

        try {
            // Set timeout to abort scan after 5 seconds
            timeoutId = setTimeout(() => {
                abortController.abort();
                logger.warn(
                    { projectPath, timeout: SCAN_LIMITS.TIMEOUT_MS },
                    'Favicon scan aborted due to timeout'
                );
                limitHit = true;
            }, SCAN_LIMITS.TIMEOUT_MS);

            const files = [];
            const uniqueDirs = new Set();

            // Stream results to check limits incrementally
            const stream = fg.stream(patterns, {
                cwd: projectPath,
                absolute: true,
                onlyFiles: true,
                ignore: IGNORE_DIRS.map((d) => `**/${d}/**`),
                deep: 5,
                followSymbolicLinks: false,
                signal: abortController.signal,
            });

            for await (const entry of stream) {
                const filePath = String(entry);
                files.push(filePath);

                // Track unique directories
                const dir = path.dirname(filePath);
                uniqueDirs.add(dir);

                // Check result limit
                if (files.length >= SCAN_LIMITS.MAX_RESULTS) {
                    abortController.abort();
                    logger.warn(
                        {
                            projectPath,
                            resultCount: files.length,
                            limit: SCAN_LIMITS.MAX_RESULTS,
                        },
                        'Favicon scan aborted due to result limit'
                    );
                    limitHit = true;
                    break;
                }

                // Check directory limit
                if (uniqueDirs.size >= SCAN_LIMITS.MAX_DIRECTORIES) {
                    abortController.abort();
                    logger.warn(
                        {
                            projectPath,
                            dirCount: uniqueDirs.size,
                            limit: SCAN_LIMITS.MAX_DIRECTORIES,
                        },
                        'Favicon scan aborted due to directory limit'
                    );
                    limitHit = true;
                    break;
                }
            }

            // Clear timeout if scan completed normally
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            if (files.length === 0) return null;

            // Single-pass min-finding: find best file without sorting all files
            let best = null;
            for (const file of files) {
                const candidate = {
                    path: file,
                    depth: file.split(path.sep).length,
                    priority: FAVICON_PATTERNS.findIndex((p) => file.endsWith(p)),
                };

                // Update best if this is better (shallower depth or better priority)
                if (
                    !best ||
                    candidate.depth < best.depth ||
                    (candidate.depth === best.depth && candidate.priority < best.priority)
                ) {
                    best = candidate;
                }
            }

            // Log scan statistics for monitoring
            if (!limitHit) {
                logger.debug(
                    {
                        projectPath,
                        filesFound: files.length,
                        dirsScanned: uniqueDirs.size,
                    },
                    'Favicon scan completed successfully'
                );
            }

            return best?.path || null;
        } catch (err) {
            // Clear timeout on error
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            // Don't log AbortError as error - it's expected when limits are hit
            if (err.name === 'AbortError') {
                logger.info({ projectPath }, 'Favicon scan aborted (limits enforced)');
                return null;
            }

            logger.warn({ err, projectPath, patterns }, 'Favicon full scan failed');
            return null;
        }
    }
}

module.exports = FaviconFinder;
