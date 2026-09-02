import { minifySync } from 'rolldown/utils';
import { defineConfig, type UserConfig } from 'tsdown';

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

function define({ dev }: { dev: boolean }): UserConfig {
  const alias = dev ? 'dev' : 'prod';

  return {
    entry: { [alias]: 'src/index.ts', [`${alias}-cea`]: 'src/cea/index.ts' },
    outDir: 'dist',
    format: 'esm',
    platform: 'neutral',
    target: 'esnext',
    hash: false,
    clean: !dev,
    treeshake: true,
    dts: !dev,
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

export default defineConfig([define({ dev: false }), define({ dev: true })]);
