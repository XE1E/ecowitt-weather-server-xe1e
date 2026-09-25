// Configuración de ESLint (formato "flat", ESLint 9+). Sustituye a .eslintrc.cjs
// (ESLint 8, ya sin soporte) con las MISMAS reglas: recomendadas de JS y de
// TypeScript, las dos reglas clásicas de hooks y react-refresh como aviso.
// De eslint-plugin-react-hooks v7 NO se activa su "recommended" nuevo (agrega las
// reglas del React Compiler): habría que revisarlas aparte, no de paso con la
// actualización de la herramienta.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
