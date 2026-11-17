// Vercel Routing Middleware: every page except the login page requires a signed-in,
// allow-listed user. Runs on Vercel's edge before any file is served.
export const config = {
  matcher: ['/((?!login\\.html|auth\\.js|api/|favicon\\.ico|icons/|site\\.webmanifest|src/version\\.js|src/theme\\.js).*)'],
};

const SB_URL = 'https://rabgawsevqkcdpbxzgak.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhYmdhd3NldnFrY2RwYnh6Z2FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MTEwNTksImV4cCI6MjExMDQ4NzA1OX0._KgqB_MBSIZIrvHxAg6eJ5Bx5pmNvz4zshOZeeNJQVc';

const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(request) {
  const url = new URL(request.url);
  const toLogin = (reason) => {
    const u = new URL('/login.html', url);
    u.searchParams.set('next', url.pathname + url.search);
    if (reason) u.searchParams.set('reason', reason);
    return Response.redirect(u.toString(), 302);
  };
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)vda_at=([^;]+)/);
  if (!m) return toLogin();
  try {
    // PostgREST validates the JWT (signature + expiry); my_role() returns the allow-list role or null.
    const r = await fetch(`${SB_URL}/rest/v1/rpc/vda_my_role`, {
      method: 'POST',
      headers: { apikey: SB_ANON, Authorization: `Bearer ${m[1]}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (r.status === 401 || r.status === 403) return toLogin('expired');
    if (!r.ok) return new Response('Sign-in service unavailable. Try again shortly.', { status: 503 });
    const role = await r.json();
    if (!role) return toLogin('not_allowed');
    if (url.pathname.startsWith('/admin') && role !== 'admin') return toLogin('admin_only');
    return pass();
  } catch (e) {
    return new Response('Sign-in check failed. Try again shortly.', { status: 503 });
  }
}
