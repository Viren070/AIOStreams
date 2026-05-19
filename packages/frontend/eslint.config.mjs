// Minimal flat config. Next.js' bundled lint config was removed during the
// Rsbuild migration; a fuller rule set can be reintroduced later if desired.
export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.next/**'],
  },
];
