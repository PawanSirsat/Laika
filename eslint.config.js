// Flat config for the whole workspace. Type-aware rules are on: every rule that
// needs type information gets it via `projectService`, which resolves each file
// to the nearest tsconfig (see server/tsconfig.json).
//
// Markdown, task files and docs are deliberately not linted here — they belong
// to PM (CLAUDE.md §1).
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'server/public/**',
      '**/*.d.ts',
    ],
  },

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md §5: a suppression must name the task that removes it, so an
      // empty `@ts-ignore` is an error and a described one is not.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Floating promises are how a single-process server loses writes silently.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  /**
   * Layering (docs/CONVENTIONS.md §2), encoded so it fails `pnpm lint` rather
   * than relying on review.
   *
   *   http/routes  →  services  →  policy
   *   mcp/         →  services  →  db
   *
   * The reason this one is enforced and the rest of CONVENTIONS is not: SPEC §7
   * requires every MCP tool to be "a thin wrapper over the same service layer the
   * REST routes use". If routes and tools can only reach data through
   * `services/`, they cannot diverge — the §13.3 parity tests then confirm a
   * property the structure already guarantees instead of being the only thing
   * holding it up.
   *
   * `@typescript-eslint/no-restricted-imports` rather than the core rule, for
   * `allowTypeImports`: a `import type` emits nothing, creates no runtime
   * coupling and cannot cause a cycle, so `policy/` naming `db/`'s enum unions is
   * not the dependency this table is about. typescript-eslint is already a
   * dependency; this adds none.
   */
  {
    files: ['server/src/db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              allowTypeImports: true,
              group: ['**/http/**', '**/services/**', '**/policy/**', '**/mcp/**'],
              message: 'db/ is the bottom layer and imports none of the others (CONVENTIONS §2).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['server/src/policy/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              allowTypeImports: true,
              group: ['**/db/**', '**/http/**', '**/services/**', '**/mcp/**', '**/auth/**'],
              message:
                'policy/ is pure: no I/O, no transport, no services (CONVENTIONS §2, SPEC §3.3).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['server/src/services/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              allowTypeImports: true,
              group: ['**/http/**', '**/mcp/**'],
              message:
                'services/ knows nothing about transport — that is what lets MCP tools reuse it (CONVENTIONS §2, SPEC §7).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['server/src/http/routes/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              allowTypeImports: true,
              group: ['**/db/**'],
              message:
                'Routes are transport only and reach data through services/ (CONVENTIONS §2).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['server/src/mcp/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              allowTypeImports: true,
              group: ['**/http/**', '**/db/**'],
              message:
                'MCP tools wrap services/, never transport or the database directly (CONVENTIONS §2, SPEC §7).',
            },
          ],
        },
      ],
    },
  },

  // Must stay last: turns off every rule Prettier owns.
  prettier,
);
