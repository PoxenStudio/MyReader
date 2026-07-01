/**
 * The `/api/mybooks/*` proxy routes normally forward to a client-supplied
 * MyBooks host/URL — the operator-typed host from the login dialog, or (in
 * the embedded-reader deployment, see document/MyReader_Embedded_WebApp.md)
 * `window.location.origin` as seen by the browser. That's correct for the
 * general "connect this MyReader web app to some external MyBooks instance"
 * case, where the Next.js server can reach that host over the network same
 * as the browser.
 *
 * It breaks when MyReader and MyBooks are deployed in the same Docker
 * container and reached through a published/mapped port (e.g. `docker run
 * -p 8082:80`): that port only exists on the Docker host, not inside the
 * container's own network namespace, so a server-side `fetch` to it gets
 * ECONNREFUSED even though the browser's request to the *same* URL works
 * fine. `MYBOOKS_INTERNAL_ORIGIN` (set in mybooks' conf/supervisor/talebook.conf,
 * program:myreader) overrides the target with a loopback address the server
 * process can actually reach. Only set in that one deployment; everywhere
 * else this is a no-op and the client-supplied host is used as before.
 */
export function resolveMyBooksInternalOrigin(clientHost: string): string {
  return process.env['MYBOOKS_INTERNAL_ORIGIN'] || clientHost;
}
