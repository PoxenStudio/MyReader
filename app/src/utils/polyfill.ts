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

// NOTE: do not polyfill Promise.withResolvers here. foliate-js decides whether
// pdf.js's worker (a separate global scope) needs that shim by probing
// `typeof Promise.withResolvers` on the main thread. Installing it here masks
// the probe on older Android WebViews, so the worker is spawned without the
// shim and opening any PDF fails with "Promise.withResolvers is not a
// function". foliate-js installs the polyfill for both scopes itself when a
// PDF is opened (packages/foliate-js/pdf.js, WITH_RESOLVERS_POLYFILL).
