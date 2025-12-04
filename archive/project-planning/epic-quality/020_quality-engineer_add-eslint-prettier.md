# 020: Add ESLint and Prettier

**Assigned Agent**: quality-engineer
**Epic**: epic-quality
**Status**: TO DO
**Estimated Effort**: S
**Priority**: P2 - MEDIUM

## Vision Alignment

Code quality tools ensure consistent style and catch common errors, supporting maintainability.

## Objective

Configure ESLint and Prettier for consistent code style and error detection.

## Requirements

- Install ESLint with recommended config
- Install Prettier for formatting
- Add security plugin
- Configure pre-commit hooks

## Acceptance Criteria

- [ ] ESLint configured with strict rules
- [ ] Prettier configured for formatting
- [ ] `npm run lint` checks code
- [ ] `npm run format` fixes formatting
- [ ] Pre-commit hook runs linter
- [ ] No existing linting errors

## Dependencies

- Depends on: 015 (test setup includes ESLint config)
- Blocks: None

## Technical Notes

```bash
npm install --save-dev \
  eslint \
  eslint-plugin-security \
  eslint-plugin-node \
  eslint-config-prettier \
  prettier \
  husky \
  lint-staged
```

**.eslintrc.js:**
```javascript
module.exports = {
    env: {
        node: true,
        es2022: true,
        jest: true
    },
    extends: [
        'eslint:recommended',
        'plugin:node/recommended',
        'plugin:security/recommended',
        'prettier'
    ],
    parserOptions: {
        ecmaVersion: 2022
    },
    rules: {
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        'no-console': 'off', // Allow console for server logs
        'security/detect-object-injection': 'warn',
        'security/detect-non-literal-fs-filename': 'error'
    }
};
```

**.prettierrc:**
```json
{
    "singleQuote": true,
    "trailingComma": "es5",
    "tabWidth": 4,
    "semi": true,
    "printWidth": 100
}
```

**package.json:**
```json
{
    "scripts": {
        "lint": "eslint .",
        "lint:fix": "eslint . --fix",
        "format": "prettier --write .",
        "format:check": "prettier --check ."
    },
    "lint-staged": {
        "*.js": ["eslint --fix", "prettier --write"]
    }
}
```

```bash
# Setup husky
npx husky install
npx husky add .husky/pre-commit "npx lint-staged"
```

## Resources

- ESLint: https://eslint.org/
- Prettier: https://prettier.io/
- Husky: https://typicode.github.io/husky/

## Testing Requirements

- [ ] Lint passes on all files
- [ ] Pre-commit hook works
- [ ] CI includes lint check

---

**Completion Instructions**:
1. When task is completed, rename file to: `done_020_quality-engineer_add-eslint-prettier.md`
2. After testing is verified, rename to: `tested_done_020_quality-engineer_add-eslint-prettier.md`
