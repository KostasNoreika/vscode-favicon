/**
 * Upload Destination Validator Module
 * Symlink detection for upload paths
 *
 * Provides:
 * - Upload destination validation
 * - Symlink detection in path components
 * - Real path resolution and validation
 *
 * SECURITY:
 * - Prevents directory traversal via symlinks (SEC-012)
 * - Validates resolved paths stay within project root
 * - Uses lstat() to detect symlinks without following them
 *
 * REF: QUA-001 - Extracted from file-validator.js to reduce file complexity
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { retryFileOperation } = require('../utils/file-operations');

/**
 * Validate upload destination to prevent symlink attacks (SEC-012)
 *
 * SECURITY: Defense against directory traversal via symlink manipulation
 * - Uses lstat() to detect symlinks without following them
 * - Resolves real path and validates it stays within project root
 * - Prevents arbitrary file write outside validated directory
 * - Retries transient filesystem errors (EAGAIN, EBUSY, ETIMEDOUT)
 *
 * PERF-009: Parallelizes independent lstat checks for tasks/ and tasks/files/
 * - Uses Promise.all to check both directories concurrently
 * - Reduces latency for upload destination validation
 *
 * Attack scenario:
 * 1. Attacker replaces tasks/ or tasks/files/ with symlink to /etc/
 * 2. Upload writes to /etc/passwd via symlink traversal
 * 3. This function detects and blocks the attack
 *
 * @param {string} validatedProjectRoot - Already validated project root path
 * @param {string} targetDir - Target directory path (e.g., {project}/tasks/files)
 * @returns {Promise<{valid: boolean, error?: string, resolvedPath?: string}>}
 */
async function validateUploadDestination(validatedProjectRoot, targetDir) {
    try {
        // Normalize project root for comparison (lowercase for case-insensitive FS)
        const normalizedRoot = path.resolve(validatedProjectRoot).toLowerCase();

        // Check each component of the path for symlinks
        const tasksDir = path.join(validatedProjectRoot, 'tasks');
        const filesDir = path.join(tasksDir, 'files');

        // PERF-009: Parallelize independent lstat checks for tasks/ and tasks/files/
        // Both directories can be checked concurrently to reduce latency
        const [tasksCheck, filesCheck] = await Promise.all([
            // Check tasks/ directory
            retryFileOperation(
                () => fs.promises.lstat(tasksDir),
                { operationName: 'lstat-tasks-dir' }
            ).then(
                stat => ({ exists: true, stat }),
                error => {
                    if (error.code === 'ENOENT') {
                        return { exists: false };
                    }
                    throw error;
                }
            ),
            // Check tasks/files/ directory
            retryFileOperation(
                () => fs.promises.lstat(filesDir),
                { operationName: 'lstat-files-dir' }
            ).then(
                stat => ({ exists: true, stat }),
                error => {
                    if (error.code === 'ENOENT') {
                        return { exists: false };
                    }
                    throw error;
                }
            ),
        ]);

        // Validate tasks/ directory if it exists
        if (tasksCheck.exists && tasksCheck.stat.isSymbolicLink()) {
            logger.warn({ tasksDir, security: 'symlink-attack' }, 'SEC-012: Symlink detected at tasks/ directory');
            return { valid: false, error: 'Symlink detected in upload path' };
        }

        // Validate tasks/files/ directory if it exists
        if (filesCheck.exists && filesCheck.stat.isSymbolicLink()) {
            logger.warn({ filesDir, security: 'symlink-attack' }, 'SEC-012: Symlink detected at tasks/files/ directory');
            return { valid: false, error: 'Symlink detected in upload path' };
        }

        // Resolve the real path of the target directory
        let resolvedPath;
        try {
            resolvedPath = await retryFileOperation(
                () => fs.promises.realpath(targetDir),
                { operationName: 'realpath-target-dir' }
            );
        } catch (error) {
            if (error.code === 'ENOENT') {
                const parentDir = path.dirname(targetDir);
                try {
                    const resolvedParent = await retryFileOperation(
                        () => fs.promises.realpath(parentDir),
                        { operationName: 'realpath-parent-dir' }
                    );
                    resolvedPath = path.join(resolvedParent, path.basename(targetDir));
                } catch (parentError) {
                    if (parentError.code === 'ENOENT') {
                        resolvedPath = path.resolve(targetDir);
                    } else {
                        throw parentError;
                    }
                }
            } else {
                throw error;
            }
        }

        // Normalize resolved path for comparison
        const normalizedResolved = resolvedPath.toLowerCase();

        // Verify resolved path is still within project root
        const rootWithSep = normalizedRoot + path.sep;
        const isWithinRoot = normalizedResolved === normalizedRoot || normalizedResolved.startsWith(rootWithSep);

        if (!isWithinRoot) {
            logger.warn({ validatedRoot: validatedProjectRoot, targetDir, resolvedPath, security: 'symlink-escape' }, 'SEC-012: Upload destination resolves outside project root');
            return { valid: false, error: 'Upload destination outside allowed directory' };
        }

        return { valid: true, resolvedPath };
    } catch (error) {
        logger.error({ err: error, validatedProjectRoot, targetDir }, 'SEC-012: Upload destination validation error');
        return { valid: false, error: 'Failed to validate upload destination' };
    }
}

module.exports = {
    validateUploadDestination,
};
