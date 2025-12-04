# 018: Write Core Function Unit Tests

**Assigned Agent**: quality-engineer
**Epic**: epic-quality
**Status**: TO DO
**Estimated Effort**: L
**Priority**: P1 - HIGH

## Vision Alignment

Unit tests for core functions ensure individual components work correctly and prevent regressions.

## Objective

Write unit tests for all core functions: registry loading, favicon generation, caching.

## Requirements

- Test registry loading (success, failure, malformed)
- Test favicon generation (various project names)
- Test cache operations (get, set, eviction)
- Mock filesystem operations

## Acceptance Criteria

- [ ] 80%+ coverage for core functions
- [ ] All edge cases tested
- [ ] Error scenarios tested
- [ ] Mocks used appropriately
- [ ] Tests are fast (<100ms each)

## Dependencies

- Depends on: 015 (Jest setup)
- Blocks: None

## Technical Notes

```javascript
// tests/unit/registry-loading.test.js
const fs = require('fs').promises;
const { loadProjectRegistry } = require('../../lib/registry');

jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn()
    }
}));

describe('Registry Loading', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('loads and parses valid registry', async () => {
        const mockRegistry = {
            projects: {
                development: [{ name: 'test', path: '/opt/dev/test' }]
            }
        };
        fs.readFile.mockResolvedValue(JSON.stringify(mockRegistry));

        const result = await loadProjectRegistry();

        expect(result).toHaveProperty('/opt/dev/test');
    });

    it('returns empty object for missing file', async () => {
        fs.readFile.mockRejectedValue(new Error('ENOENT'));

        const result = await loadProjectRegistry();

        expect(result).toEqual({});
    });

    it('returns empty object for malformed JSON', async () => {
        fs.readFile.mockResolvedValue('not valid json');

        const result = await loadProjectRegistry();

        expect(result).toEqual({});
    });
});

// tests/unit/favicon-generation.test.js
describe('Favicon Generation', () => {
    it('generates initials from project name', () => {
        expect(getInitials('my-project')).toBe('MP');
        expect(getInitials('vscode-favicon')).toBe('VF');
        expect(getInitials('single')).toBe('SI');
    });

    it('handles special characters', () => {
        expect(getInitials('project_name-test')).toBe('PN');
        expect(getInitials('123-numeric')).toBe('1N');
    });

    it('generates valid SVG', () => {
        const svg = generateFavicon('/opt/dev/test', {});

        expect(svg).toMatch(/^<svg/);
        expect(svg).toMatch(/<\/svg>$/);
        expect(svg).toContain('width="32"');
        expect(svg).toContain('height="32"');
    });

    it('uses correct color for environment', () => {
        const devSvg = generateFavicon('/opt/dev/test', { type: 'dev' });
        const prodSvg = generateFavicon('/opt/prod/test', { type: 'prod' });

        expect(devSvg).toContain('#4ECDC4'); // teal
        expect(prodSvg).toContain('#FF6B6B'); // red
    });
});

// tests/unit/cache.test.js
describe('LRU Cache', () => {
    let cache;

    beforeEach(() => {
        cache = new LRUCache(3);
    });

    it('stores and retrieves values', () => {
        cache.set('a', 1);
        expect(cache.get('a')).toBe(1);
    });

    it('evicts least recently used', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4); // Should evict 'a'

        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('d')).toBe(4);
    });

    it('updates access order on get', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.get('a'); // Access 'a', making it most recent
        cache.set('d', 4); // Should evict 'b', not 'a'

        expect(cache.get('a')).toBe(1);
        expect(cache.get('b')).toBeUndefined();
    });
});
```

## Resources

- Jest Mocking: https://jestjs.io/docs/mock-functions

## Testing Requirements

- [ ] All tests pass
- [ ] Coverage > 80%
- [ ] No external dependencies in unit tests

---

**Completion Instructions**:
1. When task is completed, rename file to: `done_018_quality-engineer_write-unit-tests.md`
2. After testing is verified, rename to: `tested_done_018_quality-engineer_write-unit-tests.md`
