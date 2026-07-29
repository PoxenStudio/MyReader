/**
 * Whether a client-supplied `fileName` is safe to interpolate into a storage
 * object key (`${userId}/${fileName}`). The R2 signer builds the key into
 * `new Request(url)`, whose WHATWG URL parser collapses `../` segments before
 * the request is signed — so an unsanitized name can escape the caller's
 * `${userId}/` prefix and write into another tenant's namespace
 * (GHSA-mfmj-2frf-vhgw).
 *
 * Legitimate names DO contain `/` (e.g. `Readest/Books/<hash>.epub`,
 * `Readest/Replicas/<kind>/<id>/<file>`), so we reject traversal rather than
 * separators: no `.`/`..`/empty path segments, no leading slash (absolute), no
 * backslash or NUL, checked on both the raw and percent-decoded forms.
 */
export const isSafeObjectKeyName = (fileName: string): boolean => {
  if (typeof fileName !== 'string' || fileName.length === 0) return false;

  const forms = [fileName];
  try {
    const decoded = decodeURIComponent(fileName);
    if (decoded !== fileName) forms.push(decoded);
  } catch {
    return false; // malformed percent-encoding
  }

  for (const form of forms) {
    if (form.includes('\\') || form.includes('\0')) return false;
    if (form.startsWith('/')) return false;
    if (form.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  }
  return true;
};
