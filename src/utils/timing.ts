export function debounce<Fn extends (...args: any[]) => void>(fn: Fn, delay): Fn {
  let timeout: any = null,
    args: any[] | undefined;

  function run() {
    clear();
    fn(...args!);
    args = undefined;
  }

  function clear() {
    clearTimeout(timeout);
    timeout = null;
  }

  function debounced() {
    args = [].slice.call(arguments);
    clear();
    timeout = setTimeout(run, delay);
  }

  return debounced as Fn;
}
