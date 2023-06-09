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

  function debounce() {
    args = [].slice.call(arguments);
    clear();
    timeout = setTimeout(run, delay);
  }

  return debounce as Fn;
}
