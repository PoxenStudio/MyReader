// A groupBy polyfill for foliate-js
Object.groupBy ??= (iterable, callbackfn) => {
  const obj = Object.create(null);
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++);
    if (key in obj) {
      obj[key].push(value);
    } else {
      obj[key] = [value];
    }
  }
  return obj;
};

Map.groupBy ??= (iterable, callbackfn) => {
  const map = new Map();
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++),
      list = map.get(key);
    if (list) {
      list.push(value);
    } else {
      map.set(key, [value]);
    }
  }
  return map;
};

// Promise.withResolvers polyfill for pdf.js on older Android WebViews (<119)
Promise.withResolvers ??= function <T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
