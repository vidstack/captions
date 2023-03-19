async function interop<T>(loader: () => Promise<T>, specifier: keyof T) {
  const mod = await loader();
  return mod[specifier] ?? (mod as any).default[specifier];
}

const globals = {
  Headers: () => interop(() => import('undici'), 'Headers'),
  ReadableStream: () => interop(() => import('node:stream/web'), 'ReadableStream'),
  TransformStream: () => interop(() => import('node:stream/web'), 'TransformStream'),
  WritableStream: () => interop(() => import('node:stream/web'), 'WritableStream'),
  Request: async () => interop(() => import('undici'), 'Request'),
  Response: () => interop(() => import('undici'), 'Response'),
  fetch: () => interop(() => import('undici'), 'fetch'),
};

for (const name in globals) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: await globals[name](),
    });
  }
}
