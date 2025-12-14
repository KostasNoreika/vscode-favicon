/**
 * Unit Tests for File Operation Error Handling (FaviconService)
 * FIX QUA-006: Tests specific error handling for file operations
 *
 * Tests different error scenarios:
 * - ENOENT: File not found (race condition)
 * - EACCES/EPERM: Permission denied
 * - EMFILE/ENFILE: Too many open files
 * - EIO: I/O error
 * - EISDIR/ENOTDIR: Path errors
 * - EBUSY: File busy
 */

const fs = require('fs');
const _path = require('path');

// Mock logger BEFORE importing FaviconService
jest.mock('../../lib/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const FaviconService = require('../../lib/services/favicon-service');
const logger = require('../../lib/logger');

describe('FaviconService - File Operation Error Handling', () => {
    let faviconService;
    let mockRegistryCache;
    let mockFaviconCache;
    let mockConfig;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock config
        mockConfig = {
            typeColors: {
                prod: '#FF6B6B',
                dev: '#4ECDC4',
            },
            defaultColors: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
        };

        // Mock registry cache
        mockRegistryCache = {
            getRegistry: jest.fn().mockResolvedValue({
                projects: {
                    '/opt/dev/testproject': {
                        name: 'Test Project',
                        type: 'dev',
                    },
                },
                original: {},
            }),
        };

        // Mock favicon cache
        mockFaviconCache = {
            get: jest.fn(),
            set: jest.fn(),
            getStats: jest.fn().mockReturnValue({
                hits: 0,
                misses: 0,
                evictions: 0,
                size: 0,
                maxSize: 100,
                hitRate: 'N/A',
                utilizationPercent: '0.0%',
            }),
        };

        faviconService = new FaviconService({
            registryCache: mockRegistryCache,
            faviconCache: mockFaviconCache,
            typeColors: mockConfig.typeColors,
            defaultColors: mockConfig.defaultColors,
        });
    });

    describe('readFileWithErrorHandling - ENOENT (File Not Found)', () => {
        test('should return null and log debug message for ENOENT', async () => {
            const testPath = '/nonexistent/favicon.png';
            const error = new Error('ENOENT: no such file or directory');
            error.code = 'ENOENT';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                    err: 'ENOENT: no such file or directory',
                }),
                'Favicon file not found (race condition)'
            );
            expect(logger.error).not.toHaveBeenCalled();
        });

        test('should handle race condition gracefully in getFavicon', async () => {
            mockFaviconCache.get.mockReturnValue(null);

            // Mock findFaviconFile to return a path
            jest.spyOn(faviconService, 'findFaviconFile').mockResolvedValue('/opt/dev/favicon.png');

            // Mock readFile to simulate file deleted between scan and read
            const error = new Error('ENOENT: no such file or directory');
            error.code = 'ENOENT';
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.getFavicon('/opt/dev/testproject');

            // Should fall back to generated SVG
            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('<svg');
            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectPath: '/opt/dev/testproject',
                    existingFavicon: '/opt/dev/favicon.png',
                }),
                'Falling back to generated favicon due to file read error'
            );
        });
    });

    describe('readFileWithErrorHandling - EACCES/EPERM (Permission Denied)', () => {
        test('should return null and log warning for EACCES', async () => {
            const testPath = '/protected/favicon.png';
            const error = new Error('EACCES: permission denied');
            error.code = 'EACCES';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                    code: 'EACCES',
                }),
                'Permission denied reading favicon file'
            );
        });

        test('should return null and log warning for EPERM', async () => {
            const testPath = '/protected/favicon.png';
            const error = new Error('EPERM: operation not permitted');
            error.code = 'EPERM';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                    code: 'EPERM',
                }),
                'Permission denied reading favicon file'
            );
        });

        test('should handle permission error in getFavicon', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            jest.spyOn(faviconService, 'findFaviconFile').mockResolvedValue(
                '/protected/favicon.png'
            );

            const error = new Error('EACCES: permission denied');
            error.code = 'EACCES';
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.getFavicon('/opt/dev/testproject');

            // Should fall back to generated SVG
            expect(result.contentType).toBe('image/svg+xml');
            expect(logger.warn).toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectPath: '/opt/dev/testproject',
                }),
                'Falling back to generated favicon due to file read error'
            );
        });
    });

    describe('readFileWithErrorHandling - EMFILE/ENFILE (Too Many Open Files)', () => {
        test('should retry on EMFILE with exponential backoff', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('EMFILE: too many open files');
            error.code = 'EMFILE';

            // Mock to fail twice, then succeed
            const mockReadFile = jest
                .spyOn(fs.promises, 'readFile')
                .mockRejectedValueOnce(error)
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce(Buffer.from('success'));

            const startTime = Date.now();
            const result = await faviconService.readFileWithErrorHandling(testPath);
            const duration = Date.now() - startTime;

            expect(result.toString()).toBe('success');
            expect(mockReadFile).toHaveBeenCalledTimes(3);

            // Verify exponential backoff delays were applied
            // First retry: 50ms, second retry: 100ms = ~150ms total minimum
            expect(duration).toBeGreaterThanOrEqual(100);

            expect(logger.warn).toHaveBeenCalledTimes(2);
            expect(logger.warn).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    code: 'EMFILE',
                    retryCount: 1,
                    maxRetries: 3,
                    delayMs: 50,
                }),
                'Too many open files - retrying with backoff'
            );
            expect(logger.warn).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    code: 'EMFILE',
                    retryCount: 2,
                    maxRetries: 3,
                    delayMs: 100,
                }),
                'Too many open files - retrying with backoff'
            );
        });

        test('should return null after max retries for EMFILE', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('EMFILE: too many open files');
            error.code = 'EMFILE';

            // Always fail
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledTimes(3); // 3 retry attempts
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    code: 'EMFILE',
                    retriesAttempted: 3,
                }),
                'Too many open files - max retries exceeded'
            );
        });

        test('should handle ENFILE with same retry logic', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('ENFILE: file table overflow');
            error.code = 'ENFILE';

            jest.spyOn(fs.promises, 'readFile')
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce(Buffer.from('success'));

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result.toString()).toBe('success');
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    code: 'ENFILE',
                }),
                'Too many open files - retrying with backoff'
            );
        });
    });

    describe('readFileWithErrorHandling - EIO (I/O Error)', () => {
        test('should return null and log error for EIO', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('EIO: i/o error');
            error.code = 'EIO';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                    err: 'EIO: i/o error',
                }),
                'I/O error reading favicon file'
            );
        });
    });

    describe('readFileWithErrorHandling - EISDIR/ENOTDIR (Path Errors)', () => {
        test('should return null and log warning for EISDIR', async () => {
            const testPath = '/opt/dev/';
            const error = new Error('EISDIR: illegal operation on a directory');
            error.code = 'EISDIR';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                }),
                'Path is a directory, not a file'
            );
        });

        test('should return null and log warning for ENOTDIR', async () => {
            const testPath = '/opt/dev/file.txt/favicon.png';
            const error = new Error('ENOTDIR: not a directory');
            error.code = 'ENOTDIR';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                }),
                'Invalid path component in favicon path'
            );
        });
    });

    describe('readFileWithErrorHandling - EBUSY (File Busy)', () => {
        test('should retry on EBUSY', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('EBUSY: resource busy or locked');
            error.code = 'EBUSY';

            jest.spyOn(fs.promises, 'readFile')
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce(Buffer.from('success'));

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result.toString()).toBe('success');
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                    retryCount: 1,
                    delayMs: 50,
                }),
                'File is busy - retrying'
            );
        });

        test('should return null after max retries for EBUSY', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('EBUSY: resource busy or locked');
            error.code = 'EBUSY';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledTimes(3);
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                    retriesAttempted: 3,
                }),
                'File is busy - max retries exceeded'
            );
        });
    });

    describe('readFileWithErrorHandling - Unknown Errors', () => {
        test('should return null and log error for unknown error codes', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('ESOMETHING: unknown error');
            error.code = 'ESOMETHING';
            error.stack = 'Error stack trace';

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                    err: 'ESOMETHING: unknown error',
                    code: 'ESOMETHING',
                    stack: 'Error stack trace',
                }),
                'Unexpected error reading favicon file'
            );
        });

        test('should handle error without code property', async () => {
            const testPath = '/opt/dev/favicon.png';
            const error = new Error('Some error without code');
            // No error.code property

            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.readFileWithErrorHandling(testPath);

            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: testPath,
                }),
                'Unexpected error reading favicon file'
            );
        });
    });

    describe('Integration - getFavicon with Error Handling', () => {
        test('should successfully read file when no errors occur', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            jest.spyOn(faviconService, 'findFaviconFile').mockResolvedValue(
                '/opt/dev/favicon.png'
            );

            const imageData = Buffer.from('PNG_DATA');
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(imageData);

            const result = await faviconService.getFavicon('/opt/dev/testproject');

            expect(result.contentType).toBe('image/png');
            expect(result.data).toBe(imageData);
            expect(mockFaviconCache.set).toHaveBeenCalled();
        });

        test('should fall back to SVG generation on any file read error', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            jest.spyOn(faviconService, 'findFaviconFile').mockResolvedValue(
                '/opt/dev/favicon.png'
            );

            const error = new Error('Generic error');
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            const result = await faviconService.getFavicon('/opt/dev/testproject');

            // Should generate SVG instead
            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('<svg');
            expect(result.data.toString()).toContain('TP'); // Test Project initials
        });

        test('should not attempt file read when no favicon file found', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            jest.spyOn(faviconService, 'findFaviconFile').mockResolvedValue(null);

            const readFileSpy = jest.spyOn(fs.promises, 'readFile');

            const result = await faviconService.getFavicon('/opt/dev/testproject');

            expect(result.contentType).toBe('image/svg+xml');
            expect(readFileSpy).not.toHaveBeenCalled();
        });
    });

    describe('Logging Levels', () => {
        test('should use debug level for ENOENT (race condition)', async () => {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            await faviconService.readFileWithErrorHandling('/test/path');

            expect(logger.debug).toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });

        test('should use warn level for permission errors', async () => {
            const error = new Error('EACCES');
            error.code = 'EACCES';
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            await faviconService.readFileWithErrorHandling('/test/path');

            expect(logger.warn).toHaveBeenCalled();
            expect(logger.debug).not.toHaveBeenCalled();
        });

        test('should use error level for I/O errors', async () => {
            const error = new Error('EIO');
            error.code = 'EIO';
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            await faviconService.readFileWithErrorHandling('/test/path');

            expect(logger.error).toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        test('should use warn for retries and error for max retries exceeded', async () => {
            const error = new Error('EMFILE');
            error.code = 'EMFILE';
            jest.spyOn(fs.promises, 'readFile').mockRejectedValue(error);

            await faviconService.readFileWithErrorHandling('/test/path');

            expect(logger.warn).toHaveBeenCalledTimes(3); // 3 retries
            expect(logger.error).toHaveBeenCalledTimes(1); // Max exceeded
        });
    });
});
