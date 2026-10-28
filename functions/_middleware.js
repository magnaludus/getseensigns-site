// Runs in front of every request. Its only job: keep the *.pages.dev copy of the site out of search results by
// adding X-Robots-Tag: noindex for requests whose hostname ends with .pages.dev. Any other host (getseensignsco.com,
// www, previews on custom domains) is passed through untouched. Canonical tags already point at getseensignsco.com.
//
// Cost note: a root _middleware.js makes Cloudflare run this Function for static files too (Pages builds a
// _routes.json that includes /*), so those requests count toward the Functions request quota. If that ever matters,
// delete this file and block or redirect pages.dev with a Cloudflare rule instead.

export async function onRequest(context) {
  const response = await context.next();
  let host = '';
  try {
    host = new URL(context.request.url).hostname.toLowerCase();
  } catch (_) {
    return response;
  }
  if (!host.endsWith('.pages.dev')) return response;
  const out = new Response(response.body, response);
  out.headers.set('X-Robots-Tag', 'noindex');
  return out;
}
