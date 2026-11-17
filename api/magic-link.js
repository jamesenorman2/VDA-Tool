// POST /api/magic-link  { email }  (admin only)
// Creates a one-time sign-in link for an allow-listed user so the admin can send it
// directly (e.g. by Outlook or Teams). Needs SUPABASE_SERVICE_ROLE_KEY in Vercel env vars.
const SB_URL = 'https://rabgawsevqkcdpbxzgak.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhYmdhd3NldnFrY2RwYnh6Z2FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MTEwNTksImV4cCI6MjExMDQ4NzA1OX0._KgqB_MBSIZIrvHxAg6eJ5Bx5pmNvz4zshOZeeNJQVc';

export default async function handler(req, res) {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return send(405, { error: 'Use POST' });
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) return send(501, { error: 'Link creation is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project environment variables.' });

  // 1. Caller must be a signed-in admin.
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(401, { error: 'Not signed in' });
  const rr = await fetch(`${SB_URL}/rest/v1/rpc/vda_my_role`, { method: 'POST', headers: { apikey: SB_ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  const role = rr.ok ? await rr.json() : null;
  if (role !== 'admin') return send(403, { error: 'Admins only' });

  // 2. Target must be on the allow list.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = String((body && body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(400, { error: 'Invalid email' });
  const ar = await fetch(`${SB_URL}/rest/v1/rpc/vda_email_allowed`, { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_email: email }) });
  if (!(ar.ok && (await ar.json()) === true)) return send(400, { error: 'That email is not on the allow list' });

  // 3. Make sure the auth user exists (ignore "already registered"), then generate the link.
  const admin = { apikey: SERVICE, 'Content-Type': 'application/json' };
  if (SERVICE.startsWith('eyJ')) admin.Authorization = `Bearer ${SERVICE}`;
  await fetch(`${SB_URL}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email, email_confirm: true }) });
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const g = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ type: 'magiclink', email, redirect_to: `${proto}://${host}/login.html` }),
  });
  const j = await g.json().catch(() => ({}));
  const link = j.action_link || (j.properties && j.properties.action_link);
  if (!g.ok || !link) return send(502, { error: j.msg || j.error_description || j.error || 'Could not create link' });
  return send(200, { email, link, note: 'Single use. Expires after the period set in Supabase (default 1 hour).' });
}
