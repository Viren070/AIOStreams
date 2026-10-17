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
            // Identifiers such as IsPlayed, ArrowLeft or Movie,Series.
            '^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+(?:,[A-Z][a-zA-Z0-9]*)*$',
            '^[A-Z][a-zA-Z0-9]*(?:,[A-Z][a-zA-Z0-9]*)+$',
            // Class lists and CSS: lowercase, with a dash, colon or bracket.
            '^(?=[^A-Z]*$)(?=.*[-:\\[(])\\S+(?:\\s+\\S+)*$',
            // Jellyfin's Authorization header.
            '^MediaBrowser ',
            '^\\w+="',
            // Names of programs and services.
            '^(AIOStreams|Jellyfin|Seanime|FFmpeg|ExoPlayer|Discord|IINA)$',
          ],
          ignoreNames: [
            { regex: { pattern: 'class', flags: 'i' } },
            { regex: { pattern: '^[A-Z0-9_-]+$' } },
            // Jellyfin's fields and query parameters.
            { regex: { pattern: '^[A-Z][a-zA-Z0-9]*$' } },
            'styleName',
            'src',
            'srcSet',
            'type',
            'id',
            'key',
            'keys',
            'code',
            'needs',
            'value',
            'types',
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
            '*.startsWith',
            '*.endsWith',
            '*.includes',
            '*.indexOf',
            '*.split',
            '*.replace',
            '*.add',
            '*.delete',
            '*.has',
            '*.get',
            '*.set',
            '*.getModifierState',
            'sendKey',
            'actionsFor',
            'dispatch',
            'ofType',
            'useSearch',
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
