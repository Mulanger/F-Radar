import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/next-env.d.ts',
      // Separate checkouts and agent state are not source files in this workspace.
      '.worktrees/**',
      '.claude/**',
      // Untouched design reference – never linted or modified.
      'FastighetsRadar dashboard complete/**',
      'dist-deploy/**',
      '.deploy/**',
      'deploy/pod/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_(?!(CLERK_(PUBLISHABLE|DEVELOPMENT)_KEY|GEOAPIFY_MAP_KEY)$).*(KEY|SECRET|TOKEN|PASSWORD)/]",
          message: 'Never expose secrets through NEXT_PUBLIC_* variables.',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
