// Only the translation rules: text a person reads goes through Lingui.
import tseslint from 'typescript-eslint';
import lingui from 'eslint-plugin-lingui';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-standalone/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true },
    },
    // React's hooks plugin only so its disable comments resolve.
    plugins: { lingui, 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'lingui/no-unlocalized-strings': [
        'error',
        {
          ignore: [
            // A single word that doesn't start with a capital: keys, ids, classes.
            '^(?![A-Z])\\S+$',
            // UPPERCASE constants and codes.
            '^[A-Z0-9_-]+$',
          ],
          ignoreNames: [
            { regex: { pattern: 'className', flags: 'i' } },
            { regex: { pattern: '^[A-Z0-9_-]+$' } },
            'styleName',
            'src',
            'srcSet',
            'type',
            'id',
            'key',
            'href',
            'to',
            'width',
            'height',
            'displayName',
            'Authorization',
          ],
          ignoreFunctions: [
            'cva',
            'cn',
            'Error',
            'console.*',
            '*.querySelector',
            '*.querySelectorAll',
            '*.closest',
            '*.matches',
            '*.addEventListener',
            '*.removeEventListener',
            '*.getAttribute',
            '*.setAttribute',
            '*.hasAttribute',
            '*.toggleAttribute',
            'matchMedia',
            'useMediaQuery',
            'createLogger',
          ],
          useTsTypes: true,
          ignoreMethodsOnTypes: ['Map.get', 'Map.has', 'Set.has'],
        },
      ],
      'lingui/t-call-in-function': 'error',
      'lingui/no-single-variables-to-translate': 'error',
      'lingui/no-expression-in-message': 'error',
      'lingui/no-single-tag-to-translate': 'error',
      'lingui/no-trans-inside-trans': 'error',
    },
  }
);
