export function debounce<T extends (...args: any[]) => void>(fn: T, delay): T {
  let timeout: any = null,
    args: any[] = [];

  function run() {
    clear();
    fn(...args);
  }

  function clear() {
    clearTimeout(timeout);
    timeout = null;
  }

  return function debounced() {
    args = [].slice.call(arguments);
    clear();
    timeout = setTimeout(run, delay);
  } as T;
}
