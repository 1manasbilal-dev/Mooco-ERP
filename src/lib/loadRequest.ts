/** A real deadline, including when a transport ignores AbortSignal. */
export function withDeadline<T>(start: (signal: AbortSignal) => PromiseLike<T>, timeoutMs = 35000): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Loading timed out. Check your connection and try again.'));
      controller.abort();
    }, timeoutMs);
    Promise.resolve().then(() => start(controller.signal)).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

export function loadRead<T>(query: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> }, timeoutMs = 35000) {
  return withDeadline(signal => typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query, timeoutMs);
}
