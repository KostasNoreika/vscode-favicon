/**
 * Unit Tests for Grayscale Functionality (FaviconService)
 * Tests grayscale conversion and terminal activity indicator feature
 */

const FaviconService = require('../../lib/services/favicon-service');
const { makeCacheKey } = require('../../lib/utils/cache-keys');

describe('Grayscale Functionality', () => {
    let faviconService;
    let mockConfig;
    let mockRegistryCache;
    let mockFaviconCache;

    beforeEach(() => {
        // Mock config
        mockConfig = {
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
            registryCache: mockRegistryCache,
            faviconCache: mockFaviconCache,
            typeColors: mockConfig.typeColors,
            defaultColors: mockConfig.defaultColors,
        });
    });

    describe('toGrayscale() - Luminosity Conversion', () => {
        test('should convert red to grayscale using luminosity formula', () => {
            // Red: R=255, G=0, B=0
            // Luminosity: 0.299*255 + 0.587*0 + 0.114*0 = 76.245 → 76 (0x4c)
            expect(faviconService.toGrayscale('#FF0000')).toBe('#4c4c4c');
        });

        test('should convert green to grayscale (brightest)', () => {
            // Green: R=0, G=255, B=0
            // Luminosity: 0.299*0 + 0.587*255 + 0.114*0 = 149.685 → 150 (0x96)
            expect(faviconService.toGrayscale('#00FF00')).toBe('#969696');
        });

        test('should convert blue to grayscale (darkest)', () => {
            // Blue: R=0, G=0, B=255
            // Luminosity: 0.299*0 + 0.587*0 + 0.114*255 = 29.07 → 29 (0x1d)
            expect(faviconService.toGrayscale('#0000FF')).toBe('#1d1d1d');
        });

        test('should preserve white', () => {
            expect(faviconService.toGrayscale('#FFFFFF')).toBe('#ffffff');
        });

        test('should preserve black', () => {
            expect(faviconService.toGrayscale('#000000')).toBe('#000000');
        });

        test('should convert dev color (#4ECDC4) to grayscale', () => {
            // Dev color: R=78, G=205, B=196
            // Luminosity: 0.299*78 + 0.587*205 + 0.114*196 = 166.176 → 166 (0xa6)
            expect(faviconService.toGrayscale('#4ECDC4')).toBe('#a6a6a6');
        });

        test('should convert prod color (#FF6B6B) to grayscale', () => {
            // Prod color: R=255, G=107, B=107
            // Luminosity: 0.299*255 + 0.587*107 + 0.114*107 = 151.352 → 151 (0x97)
            expect(faviconService.toGrayscale('#FF6B6B')).toBe('#979797');
        });

        test('should convert staging color (#FFEAA7) to grayscale', () => {
            // Staging color: R=255, G=234, B=167
            // Luminosity: 0.299*255 + 0.587*234 + 0.114*167 = 232.641 → 233 (0xe9)
            expect(faviconService.toGrayscale('#FFEAA7')).toBe('#e9e9e9');
        });

        test('should convert test color (#A29BFE) to grayscale', () => {
            // Test color: R=162, G=155, B=254
            // Luminosity: 0.299*162 + 0.587*155 + 0.114*254 = 168.379 → 168 (0xa8)
            expect(faviconService.toGrayscale('#A29BFE')).toBe('#a8a8a8');
        });

        test('should handle hex colors without # prefix', () => {
            const result = faviconService.toGrayscale('FF0000');
            expect(result).toBe('#4c4c4c');
        });

        test('should handle lowercase hex colors', () => {
            expect(faviconService.toGrayscale('#ff0000')).toBe('#4c4c4c');
            expect(faviconService.toGrayscale('#4ecdc4')).toBe('#a6a6a6');
        });

        test('should handle mixed case hex colors', () => {
            expect(faviconService.toGrayscale('#Ff6B6b')).toBe('#979797');
        });

        test('should return valid hex color format', () => {
            const colors = ['#FF0000', '#00FF00', '#0000FF', '#4ECDC4', '#FF6B6B'];
            colors.forEach((color) => {
                const result = faviconService.toGrayscale(color);
                expect(result).toMatch(/^#[a-f0-9]{6}$/i);
            });
        });

        test('should produce same grayscale value for all RGB components', () => {
            const result = faviconService.toGrayscale('#4ECDC4');
            // Extract RGB components from result
            const r = result.substring(1, 3);
            const g = result.substring(3, 5);
            const b = result.substring(5, 7);
            expect(r).toBe(g);
            expect(g).toBe(b);
        });

        test('should handle mid-range gray colors (idempotent)', () => {
            const gray = '#808080'; // Medium gray
            const result = faviconService.toGrayscale(gray);
            expect(result).toBe('#808080');
        });

        test('should convert all default colors to valid grayscale', () => {
            mockConfig.defaultColors.forEach((color) => {
                const result = faviconService.toGrayscale(color);
                expect(result).toMatch(/^#[a-f0-9]{6}$/i);
                // Verify it's truly grayscale (all RGB components equal)
                const r = result.substring(1, 3);
                const g = result.substring(3, 5);
                const b = result.substring(5, 7);
                expect(r).toBe(g);
                expect(g).toBe(b);
            });
        });
    });

    describe('generateSvgFavicon() with grayscale option', () => {
        test('should generate colored SVG by default (grayscale: false)', () => {
            const svg = faviconService.generateSvgFavicon('test-project', {
                type: 'dev',
            });

            expect(svg).toContain('#4ECDC4'); // Dev color
            expect(svg).not.toContain('#a6a6a6'); // Grayscale dev
        });

        test('should generate grayscale SVG when grayscale: true', () => {
            const svg = faviconService.generateSvgFavicon(
                'test-project',
                { type: 'dev' },
                { grayscale: true }
            );

            expect(svg).not.toContain('#4ECDC4'); // Dev color
            expect(svg).toContain('#a6a6a6'); // Grayscale dev
        });

        test('should convert prod color to grayscale when grayscale: true', () => {
            const svg = faviconService.generateSvgFavicon(
                'prod-app',
                { type: 'prod' },
                { grayscale: true }
            );

            expect(svg).not.toContain('#FF6B6B'); // Prod color
            expect(svg).toContain('#979797'); // Grayscale prod
        });

        test('should convert staging color to grayscale when grayscale: true', () => {
            const svg = faviconService.generateSvgFavicon(
                'staging-app',
                { type: 'staging' },
                { grayscale: true }
            );

            expect(svg).not.toContain('#FFEAA7'); // Staging color
            expect(svg).toContain('#e9e9e9'); // Grayscale staging
        });

        test('should preserve initials when converting to grayscale', () => {
            const coloredSvg = faviconService.generateSvgFavicon('my-project', { type: 'dev' });
            const grayscaleSvg = faviconService.generateSvgFavicon(
                'my-project',
                { type: 'dev' },
                { grayscale: true }
            );

            // Both should contain same initials
            expect(coloredSvg).toContain('MP');
            expect(grayscaleSvg).toContain('MP');
        });

        test('should preserve port text when converting to grayscale', () => {
            const svg = faviconService.generateSvgFavicon(
                'dev-app',
                { type: 'dev', port: 3000 },
                { grayscale: true }
            );

            expect(svg).toContain('3000');
            expect(svg).toContain('#a6a6a6'); // Grayscale dev
        });

        test('should handle grayscale: false explicitly', () => {
            const svg = faviconService.generateSvgFavicon(
                'test-project',
                { type: 'dev' },
                { grayscale: false }
            );

            expect(svg).toContain('#4ECDC4'); // Dev color
        });

        test('should handle empty options object (default to colored)', () => {
            const svg = faviconService.generateSvgFavicon('test-project', { type: 'dev' }, {});

            expect(svg).toContain('#4ECDC4'); // Dev color
        });

        test('should handle undefined options (default to colored)', () => {
            const svg = faviconService.generateSvgFavicon('test-project', { type: 'dev' });

            expect(svg).toContain('#4ECDC4'); // Dev color
        });

        test('should convert hash-based colors to grayscale', () => {
            // Unknown type should use hash-based color selection
            const coloredSvg = faviconService.generateSvgFavicon('custom-project', {
                type: 'unknown',
            });
            const grayscaleSvg = faviconService.generateSvgFavicon(
                'custom-project',
                { type: 'unknown' },
                { grayscale: true }
            );

            // Both should contain valid hex colors
            expect(coloredSvg).toMatch(/#[a-f0-9]{6}/i);
            expect(grayscaleSvg).toMatch(/#[a-f0-9]{6}/i);

            // Grayscale should not contain any default colors
            mockConfig.defaultColors.forEach((color) => {
                expect(grayscaleSvg).not.toContain(color);
            });
        });

        test('should generate valid SVG structure with grayscale', () => {
            const svg = faviconService.generateSvgFavicon(
                'test-project',
                { type: 'dev' },
                { grayscale: true }
            );

            expect(svg).toContain('<svg');
            expect(svg).toContain('</svg>');
            expect(svg).toContain('<rect');
            expect(svg).toContain('<text');
            expect(svg).toContain('width="32"');
            expect(svg).toContain('height="32"');
        });
    });

    describe('getFavicon() with grayscale option', () => {
        test('should use separate cache keys for colored and grayscale versions', async () => {
            mockFaviconCache.get.mockReturnValue(null);

            // FIX REF-026: Use new centralized cache key format
            const FaviconService = require('../../lib/services/favicon-service');

            await faviconService.getFavicon('/opt/dev/test-project');
            expect(mockFaviconCache.get).toHaveBeenCalledWith(
                makeCacheKey('favicon', '/opt/dev/test-project', '')
            );

            await faviconService.getFavicon('/opt/dev/test-project', { grayscale: true });
            expect(mockFaviconCache.get).toHaveBeenCalledWith(
                makeCacheKey('favicon', '/opt/dev/test-project', 'gray')
            );
        });

        test('should cache grayscale favicons separately', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    '/opt/dev/test-project': {
                        name: 'Test Project',
                        type: 'dev',
                    },
                },
                original: {},
            });

            await faviconService.getFavicon('/opt/dev/test-project', { grayscale: true });

            // FIX REF-026: Use new centralized cache key format
            const FaviconService = require('../../lib/services/favicon-service');
            const expectedKey = makeCacheKey('favicon', '/opt/dev/test-project', 'gray');

            expect(mockFaviconCache.set).toHaveBeenCalledWith(
                expectedKey,
                expect.objectContaining({
                    contentType: 'image/svg+xml',
                    data: expect.any(Buffer),
                })
            );
        });

        test('should generate grayscale SVG when grayscale: true', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    '/opt/dev/test-project': {
                        name: 'Test Project',
                        type: 'dev',
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon('/opt/dev/test-project', {
                grayscale: true,
            });

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('#a6a6a6'); // Grayscale dev
            expect(result.data.toString()).not.toContain('#4ECDC4'); // Colored dev
        });

        test('should generate colored SVG when grayscale: false', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    '/opt/dev/test-project': {
                        name: 'Test Project',
                        type: 'dev',
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon('/opt/dev/test-project', {
                grayscale: false,
            });

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('#4ECDC4'); // Colored dev
            expect(result.data.toString()).not.toContain('#a6a6a6'); // Grayscale dev
        });

        test('should default to colored when options not provided', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    '/opt/dev/test-project': {
                        name: 'Test Project',
                        type: 'dev',
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon('/opt/dev/test-project');

            expect(result.data.toString()).toContain('#4ECDC4'); // Colored dev
        });

        test('should return cached grayscale favicon if available', async () => {
            const cachedGrayscale = {
                contentType: 'image/svg+xml',
                data: Buffer.from('<svg><rect fill="#a6a6a6"/></svg>'),
            };
            mockFaviconCache.get.mockReturnValue(cachedGrayscale);

            const result = await faviconService.getFavicon('/opt/dev/test-project', {
                grayscale: true,
            });

            expect(result).toBe(cachedGrayscale);
            expect(mockRegistryCache.getRegistry).not.toHaveBeenCalled(); // Should not fetch registry
        });

        test('should handle prod project with grayscale', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    '/opt/prod/app': {
                        name: 'Production App',
                        type: 'prod',
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon('/opt/prod/app', { grayscale: true });

            expect(result.data.toString()).toContain('#979797'); // Grayscale prod
            expect(result.data.toString()).not.toContain('#FF6B6B'); // Colored prod
        });

        test('should preserve project initials in grayscale mode', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {
                    '/opt/dev/my-awesome-project': {
                        name: 'My Awesome Project',
                        type: 'dev',
                    },
                },
                original: {},
            });

            const result = await faviconService.getFavicon('/opt/dev/my-awesome-project', {
                grayscale: true,
            });

            expect(result.data.toString()).toContain('MA'); // Initials
            expect(result.data.toString()).toContain('#a6a6a6'); // Grayscale
        });
    });

    describe('Grayscale Edge Cases', () => {
        test('should handle very bright colors (near white)', () => {
            const result = faviconService.toGrayscale('#FEFEFE');
            expect(result).toBe('#fefefe');
        });

        test('should handle very dark colors (near black)', () => {
            const result = faviconService.toGrayscale('#010101');
            expect(result).toBe('#010101');
        });

        test('should handle mid-range colors', () => {
            const result = faviconService.toGrayscale('#7F7F7F');
            expect(result).toMatch(/^#[a-f0-9]{6}$/i);
        });

        test('should handle primary colors consistently', () => {
            const red = faviconService.toGrayscale('#FF0000');
            const green = faviconService.toGrayscale('#00FF00');
            const blue = faviconService.toGrayscale('#0000FF');

            // Green should be brightest (highest luminosity coefficient)
            expect(parseInt(green.substring(1, 3), 16)).toBeGreaterThan(
                parseInt(red.substring(1, 3), 16)
            );
            expect(parseInt(green.substring(1, 3), 16)).toBeGreaterThan(
                parseInt(blue.substring(1, 3), 16)
            );

            // Blue should be darkest (lowest luminosity coefficient)
            expect(parseInt(blue.substring(1, 3), 16)).toBeLessThan(
                parseInt(red.substring(1, 3), 16)
            );
        });

        test('should handle grayscale option with null project info', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {},
                original: {},
            });

            const result = await faviconService.getFavicon('/opt/dev/unknown', {
                grayscale: true,
            });

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('<svg');
        });

        test('should handle grayscale option with empty project name', async () => {
            mockFaviconCache.get.mockReturnValue(null);
            mockRegistryCache.getRegistry.mockResolvedValue({
                projects: {},
                original: {},
            });

            const result = await faviconService.getFavicon('', { grayscale: true });

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('<svg');
        });
    });

    describe('Luminosity Formula Validation', () => {
        test('should use correct ITU-R BT.601 coefficients', () => {
            // Formula: 0.299*R + 0.587*G + 0.114*B
            // Pure red (255, 0, 0): 0.299 * 255 = 76.245
            const red = faviconService.toGrayscale('#FF0000');
            expect(parseInt(red.substring(1, 3), 16)).toBe(76);

            // Pure green (0, 255, 0): 0.587 * 255 = 149.685
            const green = faviconService.toGrayscale('#00FF00');
            expect(parseInt(green.substring(1, 3), 16)).toBe(150);

            // Pure blue (0, 0, 255): 0.114 * 255 = 29.07
            const blue = faviconService.toGrayscale('#0000FF');
            expect(parseInt(blue.substring(1, 3), 16)).toBe(29);
        });

        test('should sum coefficients to 1.0', () => {
            // 0.299 + 0.587 + 0.114 = 1.0
            // Full white (255, 255, 255): should equal 255
            const white = faviconService.toGrayscale('#FFFFFF');
            expect(white).toBe('#ffffff');
        });
    });
});
