import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/**', 'node_modules/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Drizzle queries belong in repositories only. See CLAUDE.md.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/client'],
              message:
                'Import the db handle only in *.repository.ts, db/migrate.ts, or db/seed.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // The layering rule above does not apply to the layer that owns the DB.
    files: [
      'src/**/*.repository.ts',
      'src/db/**/*.ts',
      'src/app.ts',
      'src/modules/health/**/*.ts',
      'test/**/*.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettierRecommended,
  { rules: { 'prettier/prettier': ['error', { endOfLine: 'auto' }] } },
);
