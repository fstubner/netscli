import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Lint config for the GUI (C-22).
 *
 * There was no ESLint config or lint script anywhere here, which `AGENTS.md`
 * acknowledged. The gap mattered more than usual: `react-hooks` is the rule
 * set that catches stale closures and wrong dependency arrays, and A-13,
 * B-16 and B-18 were all exactly that shape.
 *
 * Deliberately narrow to start. This runs over a codebase that has never been
 * linted, so a maximal rule set would produce hundreds of findings and get
 * switched off. The rules enabled here are the ones tied to bugs this project
 * has actually shipped; style is left to the existing conventions.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', 'e2e/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The two that would have caught A-13 and B-18.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Unused code is nearly always a leftover from a partial edit, but an
      // underscore prefix is the established way to say "deliberately unused"
      // and appears throughout this codebase already.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // The audit found exactly one `any` in the whole GUI, in a test
      // fixture. Keeping this an error protects a genuinely strong property
      // rather than imposing a new one.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Tests reach into internals and build partial fixtures on purpose.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
