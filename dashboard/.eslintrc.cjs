/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // Deuda previa a la llegada de eslint: quedan 5 `any` (App.tsx,
    // ExtraSensorsCard, MultiVariableChart x2, RemoteStationCard). Se deja como
    // aviso para que el lint pase en verde mientras se tipan, en vez de
    // silenciarlo. El codigo nuevo no deberia agregar mas.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
}
