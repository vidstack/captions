declare global {
  const __DEV__: boolean;

  // Per-element caches keyed by module-private symbols (layout measurements, etc.).
  interface HTMLElement {
    [cache: symbol]: any;
  }
}

export {};
