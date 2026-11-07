// Legacy-host redirect Worker (SORTEY-31).
// sortie.gmac.io and trip.gmac.io served old pre-rebrand builds of this app.
// Both now send every request to the same path and query on https://sortey.app,
// where the observe.gmac.io analytics snippet runs (project `trip`).

const TARGET_ORIGIN = "https://sortey.app";

/** @param {Request} request */
export function redirect(request) {
  const url = new URL(request.url);
  const location = TARGET_ORIGIN + url.pathname + url.search;
  // 301 for page loads; 308 keeps the method and body for old API clients.
  const status =
    request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, {
    status,
    headers: { location, "cache-control": "public, max-age=3600" },
  });
}

export default { fetch: redirect };
