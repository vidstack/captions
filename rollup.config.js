import { defineConfig } from 'rollup';
import esbuild from 'rollup-plugin-esbuild';

export default defineConfig([
  // dev
  define({ dev: true }),
  // prod
  define({ dev: false }),
  // server
  define({ dev: true, server: true }),
]);

/** @returns {import('rollup').RollupOptions} */
function define({ dev = false, server = false }) {
  const alias = server ? 'server' : dev ? 'dev' : 'prod';
  return {
    input: {
      [alias]: 'src/index.ts',
    },
    treeshake: true,
    output: {
      format: 'esm',
      dir: 'dist',
      chunkFileNames: `${alias}/[name].js`,
    },
    plugins: [
      esbuild({
        target: server ? 'node16' : 'esnext',
        platform: server ? 'node' : 'browser',
        tsconfig: 'tsconfig.build.json',
        define: {
          __DEV__: dev ? 'true' : 'false',
          __SERVER__: server ? 'true' : 'false',
        },
        mangleProps: !dev && !server ? /^_/ : undefined,
      }),
    ],
  };
}
