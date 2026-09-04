import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      /* eslint-plugin-react-hooks v7 ships this as 'error' by default, unlike
         its sibling exhaustive-deps ('warn') — despite catching the same kind
         of case: an effect that has to run on mount for a real external
         reason (parsing a URL fragment, fetching on load) and happens to also
         call setState. Matched to exhaustive-deps' severity rather than
         rewriting every such effect under CI pressure. */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
