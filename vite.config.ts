import { playwright } from '@vitest/browser-playwright';
import { minifySync } from 'rolldown/utils';
import { defineConfig, type PackUserConfig } from 'vite-plus';

// Files that are vendored or generated and must never be reformatted or linted.
const GENERATED = [
  'dist/**',
  'sandbox/**',
  '.vitest-attachments/**',
  'assets/**',
  'tests/wpt/vendor/**',
  'tests/wpt/fixtures/**',
  'tests/imsc/vendor/**',
  'tests/corpus/__snapshots__/**',
  'tests/corpus/files/**',
  'tests/browser/__screenshots__/**',
  'src/entities/html-entities.ts',
  'pnpm-lock.yaml',
  'CHANGELOG.md',
];

const PARSERS: [string, string][] = [
  ['vtt', 'src/vtt/vtt-parser.ts'],
  ['srt', 'src/srt/srt-parser.ts'],
  ['ssa', 'src/ssa/ssa-parser.ts'],
  ['ttml', 'src/ttml/ttml-parser.ts'],
  ['scc', 'src/scc/scc-parser.ts'],
  ['lrc', 'src/lrc/lrc-parser.ts'],
  ['sbv', 'src/sbv/sbv-parser.ts'],
  ['sami', 'src/sami/sami-parser.ts'],
  ['microdvd', 'src/microdvd/microdvd-parser.ts'],
];

/**
 * Mangles private `_` members across all chunks. Rolldown only supports `mangleProps` for
 * single-chunk builds, so this runs per chunk with a shared cache to keep names consistent.
 */
function manglePrivateMembers() {
  let cache: Record<string, string | false> = {};
  return {
    name: 'mangle-private-members',
    renderChunk(code: string, chunk: { fileName: string }) {
      const result = minifySync(chunk.fileName, code, {
        compress: false,
        mangle: false,
        codegen: false,
        mangleProps: { include: /^_/, cache },
      });
      if (result.errors.length) throw new Error(result.errors.map((e) => e.message).join('\n'));
      cache = result.mangleCache ?? cache;
      return { code: result.code, map: result.map };
    },
  };
}

function pack({ dev }: { dev: boolean }): PackUserConfig {
  const alias = dev ? 'dev' : 'prod';

  return {
    entry: {
      [alias]: 'src/index.ts',
      [`${alias}-cea`]: 'src/cea/index.ts',
      [`${alias}-element`]: 'src/element/index.ts',
      [`${alias}-entities`]: 'src/entities/index.ts',
      [`${alias}-mp4`]: 'src/mp4/index.ts',
      // Explicit per-format entries for bundlers/runtimes that can not follow dynamic imports.
      ...Object.fromEntries(PARSERS.map(([name, path]) => [`${alias}-parser-${name}`, path])),
    },
    outDir: 'dist',
    format: 'esm',
    platform: 'neutral',
    target: 'esnext',
    hash: false,
    clean: !dev,
    treeshake: true,
    dts: !dev,
    // Package checks run on the prod build. This is an ESM-only package, so the node10 and
    // CJS-resolution attw profiles do not apply.
    publint: !dev,
    attw: dev ? false : { profile: 'esm-only' },
    define: {
      __DEV__: dev ? 'true' : 'false',
    },
    outputOptions: {
      chunkFileNames: `${alias}/[name].js`,
    },
    // Output stays readable (consumers minify themselves); only private members are mangled.
    plugins: dev ? [] : [manglePrivateMembers()],
  };
}

export default defineConfig({
  define: {
    __DEV__: 'true',
  },
  resolve: {
    alias: {
      'media-captions/cea': '/src/cea/index',
      'media-captions/element': '/src/element/index',
      'media-captions/entities': '/src/entities/index',
      'media-captions/mp4': '/src/mp4/index',
      'media-captions': '/src/index',
    },
  },

  test: {
    globals: true,
    testTimeout: 5000,
    benchmark: {
      include: ['tests/bench/**/*.bench.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/browser/**'],
          setupFiles: ['tests/polyfills.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          // Benchmarks are Node-only; `extends` merges arrays so exclude rather than empty include.
          benchmark: { exclude: ['tests/bench/**'] },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
            viewport: { width: 1280, height: 800 },
          },
        },
      },
    ],
  },

  pack: [pack({ dev: false }), pack({ dev: true })],

  fmt: {
    printWidth: 100,
    tabWidth: 2,
    singleQuote: true,
    trailingComma: 'all',
    sortImports: {
      newlinesBetween: true,
      groups: [
        'side_effect_style',
        'side_effect',
        'builtin',
        'external',
        'internal',
        ['parent', 'sibling', 'index'],
      ],
    },
    ignorePatterns: GENERATED,
  },

  lint: {
    plugins: ['typescript', 'unicorn', 'oxc'],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
    },
    rules: {
      // Private members are prefixed with `_` so the build can mangle them.
      'no-underscore-dangle': 'off',
      // Parsers use intentional switch fallthrough.
      'no-fallthrough': 'off',
      // In-place sort/reverse of freshly built local arrays is deliberate and cheaper.
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-reverse': 'off',
      // `export {}` is the standard way to mark ambient files as modules.
      'unicorn/require-module-specifiers': 'off',
      'unicorn/consistent-function-scoping': 'off',
      // Tests and browser code use non-null assertions on DOM lookups deliberately.
      'typescript/no-non-null-assertion': 'off',
    },
    ignorePatterns: GENERATED,
  },

  check: {
    fmt: true,
    lint: true,
  },
});
