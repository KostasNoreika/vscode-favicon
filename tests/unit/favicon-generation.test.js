/**
 * Unit Tests for Favicon Generation (FaviconService)
 * Tests SVG generation, color handling, initials extraction, and favicon lookup
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const FaviconService = require('../../lib/services/favicon-service');

describe('Favicon Generation', () => {
    let faviconService;
    let mockConfig;
    let mockRegistryCache;
    let mockFaviconCache;
    let testProjectPath;

    beforeEach(() => {
        // Setup test directory
        testProjectPath = path.join(os.tmpdir(), `test-project-${Date.now()}`);
        fs.mkdirSync(testProjectPath, { recursive: true });

        // Mock config
        mockConfig = {
            faviconSearchPaths: ['favicon.ico', 'public/favicon.ico', 'web/favicon.ico'],
            faviconImagePatterns: ['favicon.png', 'favicon.svg', 'logo.png'],
            faviconImageDirs: ['', 'public', 'assets', 'static'],
            typeColors: {
                prod: '#FF6B6B',
                dev: '#4ECDC4',
                staging: '#FFEAA7',
                test: '#A29BFE',
            },
            defaultColors: [
                '#FF6B6B',
                '#4ECDC4',
                '#45B7D1',
                '#96CEB4',
                '#FFEAA7',
                '#FD79A8',
                '#A29BFE',
                '#6C5CE7',
            ],
        };

        // Mock registry cache
        mockRegistryCache = {
            getRegistry: jest.fn().mockResolvedValue({
                projects: {},
                original: {},
            }),
        };

        // Mock favicon cache
        mockFaviconCache = {
            get: jest.fn(),
            set: jest.fn(),
        };

        faviconService = new FaviconService({
            config: mockConfig,
            registryCache: mockRegistryCache,
            faviconCache: mockFaviconCache,
        });
    });

    afterEach(() => {
        // Cleanup test directory
        if (fs.existsSync(testProjectPath)) {
            fs.rmSync(testProjectPath, { recursive: true, force: true });
        }
    });

    describe('Initials Generation', () => {
        test('should generate initials from two-word names', () => {
            expect(faviconService.generateInitials('my project')).toBe('MP');
            expect(faviconService.generateInitials('hello world')).toBe('HW');
        });

        test('should generate initials from hyphenated names', () => {
            expect(faviconService.generateInitials('vscode-favicon')).toBe('VF');
            expect(faviconService.generateInitials('react-native-app')).toBe('RN');
        });

        test('should generate initials from underscore-separated names', () => {
            expect(faviconService.generateInitials('test_project')).toBe('TP');
            expect(faviconService.generateInitials('my_awesome_app')).toBe('MA');
        });

        test('should handle mixed separators', () => {
            expect(faviconService.generateInitials('my-awesome_project name')).toBe('MA');
        });

        test('should handle single-word names by taking first character', () => {
            // Single words split to one element, so only first char is taken
            expect(faviconService.generateInitials('app')).toBe('A');
            expect(faviconService.generateInitials('project')).toBe('P');
        });

        test('should limit initials to 2 characters', () => {
            expect(faviconService.generateInitials('one two three four')).toBe('OT');
        });

        test('should handle very short names', () => {
            expect(faviconService.generateInitials('a')).toBe('A');
            expect(faviconService.generateInitials('x-y')).toBe('XY');
        });

        test('should convert to uppercase', () => {
            expect(faviconService.generateInitials('my-app')).toBe('MA');
            expect(faviconService.generateInitials('MixedCase-Name')).toBe('MN');
        });

        test('should handle empty strings', () => {
            expect(faviconService.generateInitials('')).toBe('');
        });

        test('should handle special characters', () => {
            expect(faviconService.generateInitials('project-v2')).toBe('PV');
            expect(faviconService.generateInitials('api-service')).toBe('AS');
        });

        test('should handle numbers', () => {
            expect(faviconService.generateInitials('app-v2')).toBe('AV');
            expect(faviconService.generateInitials('project-123-test')).toBe('P1');
        });
    });

    describe('Color Selection', () => {
        test('should return correct color for known types', () => {
            expect(faviconService.getTypeColor('prod', 'test')).toBe('#FF6B6B');
            expect(faviconService.getTypeColor('dev', 'test')).toBe('#4ECDC4');
            expect(faviconService.getTypeColor('staging', 'test')).toBe('#FFEAA7');
            expect(faviconService.getTypeColor('test', 'test')).toBe('#A29BFE');
        });

        test('should generate deterministic color for unknown types', () => {
            const color1 = faviconService.getTypeColor('custom', 'project-name');
            const color2 = faviconService.getTypeColor('custom', 'project-name');
            expect(color1).toBe(color2);
        });

        test('should generate different colors for different project names', () => {
            const color1 = faviconService.getTypeColor('unknown', 'project-a');
            const color2 = faviconService.getTypeColor('unknown', 'project-b');
            // Different projects should likely get different colors
            // (though hash collision is possible)
            expect(typeof color1).toBe('string');
            expect(typeof color2).toBe('string');
        });

        test('should use default colors array for hash-based selection', () => {
            const color = faviconService.getTypeColor('unknown', 'test-project');
            expect(mockConfig.defaultColors).toContain(color);
        });

        test('should handle empty project names', () => {
            const color = faviconService.getTypeColor('unknown', '');
            expect(mockConfig.defaultColors).toContain(color);
        });

        test('should be case-sensitive for type matching', () => {
            expect(faviconService.getTypeColor('PROD', 'test')).not.toBe('#FF6B6B');
            expect(faviconService.getTypeColor('Dev', 'test')).not.toBe('#4ECDC4');
        });
    });

    describe('Port Text Generation', () => {
        test('should show port text for dev projects', () => {
            const portText = faviconService.generatePortText('dev', 3000);
            expect(portText).toContain('3000');
            expect(portText).toContain('text');
        });

        test('should not show port text for prod projects', () => {
            const portText = faviconService.generatePortText('prod', 8080);
            expect(portText).toBe('');
        });

        test('should not show port text when port is empty', () => {
            const portText = faviconService.generatePortText('dev', '');
            expect(portText).toBe('');
        });

        test('should not show port text when port is null', () => {
            const portText = faviconService.generatePortText('dev', null);
            expect(portText).toBe('');
        });

        test('should handle string port numbers', () => {
            const portText = faviconService.generatePortText('dev', '3000');
            expect(portText).toContain('3000');
        });

        test('should include correct SVG attributes', () => {
            const portText = faviconService.generatePortText('dev', 3000);
            expect(portText).toContain('text-anchor="middle"');
            expect(portText).toContain('fill="white"');
            expect(portText).toContain('font-family="monospace"');
            expect(portText).toContain('font-size="6"');
            expect(portText).toContain('opacity="0.8"');
        });
    });

    describe('SVG Generation', () => {
        test('should generate valid SVG structure', () => {
            const svg = faviconService.generateSvgFavicon('test-project');

            expect(svg).toContain('<svg');
            expect(svg).toContain('</svg>');
            expect(svg).toContain('width="32"');
            expect(svg).toContain('height="32"');
            expect(svg).toContain('<rect');
            expect(svg).toContain('<text');
        });

        test('should include project initials', () => {
            const svg = faviconService.generateSvgFavicon('my-awesome-project');
            expect(svg).toContain('MA');
        });

        test('should use project info when provided', () => {
            const svg = faviconService.generateSvgFavicon('path-name', {
                name: 'Custom Name',
                type: 'prod',
            });

            expect(svg).toContain('CN'); // Initials of Custom Name
            expect(svg).toContain('#FF6B6B'); // Prod color
        });

        test('should include port for dev projects', () => {
            const svg = faviconService.generateSvgFavicon('dev-app', {
                name: 'Development App',
                type: 'dev',
                port: 3000,
            });

            expect(svg).toContain('3000');
        });

        test('should not include port for prod projects', () => {
            const svg = faviconService.generateSvgFavicon('prod-app', {
                name: 'Production App',
                type: 'prod',
                port: 8080,
            });

            expect(svg).not.toContain('8080');
        });

        test('should handle empty project info', () => {
            const svg = faviconService.generateSvgFavicon('test-project', {});
            expect(svg).toContain('TP');
            expect(svg).toContain('<svg');
        });

        test('should apply correct text styling', () => {
            const svg = faviconService.generateSvgFavicon('test');

            expect(svg).toContain('text-anchor="middle"');
            expect(svg).toContain('fill="white"');
            expect(svg).toContain('font-family="Arial, sans-serif"');
            expect(svg).toContain('font-size="14"');
            expect(svg).toContain('font-weight="bold"');
        });

        test('should apply rounded corners to rectangle', () => {
            const svg = faviconService.generateSvgFavicon('test');
            expect(svg).toContain('rx="4"');
        });

        test('should position text correctly', () => {
            const svg = faviconService.generateSvgFavicon('test');
            expect(svg).toContain('x="16" y="21"'); // Main text
        });

        test('should handle special characters in project names', () => {
            const svg = faviconService.generateSvgFavicon('test@2024');
            expect(svg).toContain('<svg');
            expect(svg).not.toContain('@'); // Should be converted to initials
        });
    });

    describe('Content Type Detection', () => {
        test('should detect PNG files', () => {
            expect(faviconService.getContentType('favicon.png')).toBe('image/png');
            expect(faviconService.getContentType('/path/to/icon.png')).toBe('image/png');
        });

        test('should detect SVG files', () => {
            expect(faviconService.getContentType('favicon.svg')).toBe('image/svg+xml');
            expect(faviconService.getContentType('/path/to/logo.svg')).toBe('image/svg+xml');
        });

        test('should detect ICO files', () => {
            expect(faviconService.getContentType('favicon.ico')).toBe('image/x-icon');
            expect(faviconService.getContentType('/path/to/icon.ico')).toBe('image/x-icon');
        });

        test('should handle uppercase extensions', () => {
            expect(faviconService.getContentType('FAVICON.PNG')).toBe('image/png');
            expect(faviconService.getContentType('LOGO.SVG')).toBe('image/svg+xml');
        });

        test('should handle mixed case extensions', () => {
            expect(faviconService.getContentType('favicon.PnG')).toBe('image/png');
        });

        test('should default to ico for unknown extensions', () => {
            expect(faviconService.getContentType('favicon.jpg')).toBe('image/x-icon');
            expect(faviconService.getContentType('favicon.gif')).toBe('image/x-icon');
            expect(faviconService.getContentType('favicon')).toBe('image/x-icon');
        });
    });

    describe('Search Paths Building', () => {
        test('should build search paths from config', () => {
            const paths = faviconService.buildSearchPaths('/opt/dev/project');

            expect(paths).toContain('/opt/dev/project/favicon.ico');
            expect(paths).toContain('/opt/dev/project/public/favicon.ico');
            expect(paths).toContain('/opt/dev/project/web/favicon.ico');
        });

        test('should include image patterns', () => {
            const paths = faviconService.buildSearchPaths('/opt/dev/project');

            expect(paths).toContain('/opt/dev/project/favicon.png');
            expect(paths).toContain('/opt/dev/project/public/favicon.png');
            expect(paths).toContain('/opt/dev/project/favicon.svg');
        });

        test('should combine all directories with patterns', () => {
            const paths = faviconService.buildSearchPaths('/opt/dev/project');

            expect(paths).toContain('/opt/dev/project/public/logo.png');
            expect(paths).toContain('/opt/dev/project/assets/logo.png');
            expect(paths).toContain('/opt/dev/project/static/logo.png');
        });

        test('should handle root directory patterns', () => {
            const paths = faviconService.buildSearchPaths('/opt/dev/project');

            // Empty string in dirs should place files in project root
            expect(paths.some((p) => p === '/opt/dev/project/favicon.png')).toBe(true);
        });

        test('should return array of absolute paths', () => {
            const paths = faviconService.buildSearchPaths('/opt/dev/project');

            paths.forEach((p) => {
                expect(path.isAbsolute(p)).toBe(true);
            });
        });
    });

    describe('Favicon File Lookup', () => {
        test('should find existing favicon.ico', async () => {
            const faviconPath = path.join(testProjectPath, 'favicon.ico');
            fs.writeFileSync(faviconPath, 'fake-ico-data');

            const result = await faviconService.findFaviconFile(testProjectPath);
            expect(result).toBe(faviconPath);
        });

        test('should find favicon in public directory', async () => {
            const publicDir = path.join(testProjectPath, 'public');
            fs.mkdirSync(publicDir, { recursive: true });
            const faviconPath = path.join(publicDir, 'favicon.ico');
            fs.writeFileSync(faviconPath, 'fake-ico-data');

            const result = await faviconService.findFaviconFile(testProjectPath);
            expect(result).toBe(faviconPath);
        });

        test('should find PNG favicon', async () => {
            const faviconPath = path.join(testProjectPath, 'favicon.png');
            fs.writeFileSync(faviconPath, 'fake-png-data');

            const result = await faviconService.findFaviconFile(testProjectPath);
            expect(result).toBe(faviconPath);
        });

        test('should return null when no favicon found', async () => {
            const result = await faviconService.findFaviconFile(testProjectPath);
            expect(result).toBeNull();
        });

        test('should prioritize by search order', async () => {
            // Create multiple favicons
            fs.writeFileSync(path.join(testProjectPath, 'favicon.ico'), 'ico');

            const publicDir = path.join(testProjectPath, 'public');
            fs.mkdirSync(publicDir, { recursive: true });
            fs.writeFileSync(path.join(publicDir, 'favicon.ico'), 'public-ico');

            const result = await faviconService.findFaviconFile(testProjectPath);
            // Should find root favicon.ico first
            expect(result).toBe(path.join(testProjectPath, 'favicon.ico'));
        });

        test('should handle unreadable files', async () => {
            const faviconPath = path.join(testProjectPath, 'favicon.ico');
            fs.writeFileSync(faviconPath, 'data');

            // Make unreadable (if permissions allow)
            try {
                fs.chmodSync(faviconPath, 0o000);
                const result = await faviconService.findFaviconFile(testProjectPath);
                // Should continue searching and return null
                expect(result).toBeNull();
            } finally {
                // Restore permissions for cleanup
                fs.chmodSync(faviconPath, 0o644);
            }
        });
    });

    describe('getFavicon Integration', () => {
        test('should use cache when available', async () => {
            const cachedResult = {
                contentType: 'image/svg+xml',
                data: Buffer.from('<svg></svg>'),
            };
            mockFaviconCache.get.mockReturnValue(cachedResult);

            const result = await faviconService.getFavicon('/opt/dev/test');

            expect(result).toBe(cachedResult);
            expect(mockFaviconCache.get).toHaveBeenCalledWith('favicon_/opt/dev/test');
        });

        test('should return existing favicon file when found', async () => {
            mockFaviconCache.get.mockReturnValue(null);

            const faviconPath = path.join(testProjectPath, 'favicon.ico');
            fs.writeFileSync(faviconPath, 'test-favicon-data');

            const result = await faviconService.getFavicon(testProjectPath);

            expect(result.contentType).toBe('image/x-icon');
            expect(result.data.toString()).toBe('test-favicon-data');
            expect(mockFaviconCache.set).toHaveBeenCalled();
        });

        test('should generate SVG when no favicon file exists', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    [testProjectPath]: {
                        name: 'Test Project',
                        type: 'dev',
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon(testProjectPath);

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('<svg');
            expect(result.data.toString()).toContain('TP'); // Test Project initials
        });

        test('should use project info from registry', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    [testProjectPath]: {
                        name: 'Custom Name',
                        type: 'prod',
                        port: 8080,
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon(testProjectPath);

            expect(result.data.toString()).toContain('CN'); // Custom Name initials
            expect(result.data.toString()).toContain('#FF6B6B'); // Prod color
        });

        test('should cache generated favicons', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {},
                original: {},
            });

            await faviconService.getFavicon(testProjectPath);

            expect(mockFaviconCache.set).toHaveBeenCalledWith(
                `favicon_${testProjectPath}`,
                expect.objectContaining({
                    contentType: 'image/svg+xml',
                    data: expect.any(Buffer),
                })
            );
        });

        test('should lookup by project name when path not found', async () => {
            const projectName = path.basename(testProjectPath);
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    [projectName]: {
                        name: 'By Name',
                        type: 'dev',
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon(testProjectPath);

            expect(result.data.toString()).toContain('BN'); // By Name initials
        });

        test('should handle missing project info gracefully', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {},
                original: {},
            });

            const result = await faviconService.getFavicon(testProjectPath);

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('<svg');
        });

        test('should read PNG favicon correctly', async () => {
            mockFaviconCache.get.mockReturnValue(null);

            const faviconPath = path.join(testProjectPath, 'favicon.png');
            const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
            fs.writeFileSync(faviconPath, pngData);

            const result = await faviconService.getFavicon(testProjectPath);

            expect(result.contentType).toBe('image/png');
            expect(result.data.equals(pngData)).toBe(true);
        });

        test('should read SVG favicon correctly', async () => {
            mockFaviconCache.get.mockReturnValue(null);

            const faviconPath = path.join(testProjectPath, 'favicon.svg');
            const svgData = '<svg width="32" height="32"></svg>';
            fs.writeFileSync(faviconPath, svgData);

            const result = await faviconService.getFavicon(testProjectPath);

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toBe(svgData);
        });
    });

    describe('Edge Cases', () => {
        test('should handle very long project names', () => {
            const longName = 'a'.repeat(1000);
            const svg = faviconService.generateSvgFavicon(longName);
            expect(svg).toContain('<svg');
        });

        test('should handle project names with special XML characters', () => {
            const svg = faviconService.generateSvgFavicon('test<>&"\'');
            expect(svg).toContain('<svg');
        });

        test('should handle non-existent project paths', async () => {
            const result = await faviconService.getFavicon('/non/existent/path');
            expect(result.contentType).toBe('image/svg+xml');
        });

        test('should handle empty project path', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {},
                original: {},
            });

            const result = await faviconService.getFavicon('');
            expect(result.contentType).toBe('image/svg+xml');
        });

        test('should handle project names with only special characters', () => {
            const initials = faviconService.generateInitials('!!!');
            expect(typeof initials).toBe('string');
        });

        test('should handle zero port number', () => {
            const portText = faviconService.generatePortText('dev', 0);
            expect(portText).toBe('');
        });

        test('should handle very high port numbers', () => {
            const portText = faviconService.generatePortText('dev', 65535);
            expect(portText).toContain('65535');
        });
    });
});
