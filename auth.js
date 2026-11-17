// VDA Tool sign-in. Uses the Blast Tool's Supabase project (same accounts) with its own allow list,
// public.vda_allowed_users. Shared by every page.
// The anon key is public by design; access is enforced by middleware.js (server side)
// and by row-level security on public.allowed_users.
(function () {
  'use strict';
  var SB_URL = 'https://rabgawsevqkcdpbxzgak.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhYmdhd3NldnFrY2RwYnh6Z2FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MTEwNTksImV4cCI6MjExMDQ4NzA1OX0._KgqB_MBSIZIrvHxAg6eJ5Bx5pmNvz4zshOZeeNJQVc';
  var COOKIE = 'vda_at';
  if (!window.supabase || !window.supabase.createClient) { window.VDA_AUTH = null; return; }

  var sb = window.supabase.createClient(SB_URL, SB_ANON, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });

  // Mirror the access token into a cookie so Vercel middleware can check it before serving pages.
  function setCookie(sess) {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    if (!sess) { document.cookie = COOKIE + '=; Path=/; Max-Age=0; SameSite=Lax' + secure; return; }
    var age = Math.max(60, (sess.expires_at || 0) - Math.floor(Date.now() / 1000));
    document.cookie = COOKIE + '=' + sess.access_token + '; Path=/; Max-Age=' + age + '; SameSite=Lax' + secure;
  }
  sb.auth.onAuthStateChange(function (_ev, sess) { setCookie(sess); });

  async function session() { var r = await sb.auth.getSession(); setCookie(r.data.session); return r.data.session; }
  async function role() { var r = await sb.rpc('vda_my_role'); return r.error ? null : r.data; }
  async function signOut() { await sb.auth.signOut(); setCookie(null); location.href = '/login.html'; }

  // Header badge: "email · Admin · Sign out" on protected pages that include <span id="vdaUser">.
  async function mountBadge() {
    var el = document.getElementById('vdaUser');
    if (!el) return;
    var s = await session();
    if (!s) return;
    var r = await role();
    var email = (s.user && s.user.email) || '';
    el.innerHTML = '';
    var who = document.createElement('span'); who.className = 'vda-who'; who.textContent = email + (r === 'admin' ? ' (admin)' : '');
    el.appendChild(who);
    if (r === 'admin') { var a = document.createElement('a'); a.href = 'admin.html'; a.className = 'navlink'; a.textContent = 'Admin'; el.appendChild(a); }
    var b = document.createElement('button'); b.textContent = 'Sign out'; b.onclick = signOut; el.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBadge); else mountBadge();

  window.VDA_AUTH = { sb: sb, session: session, role: role, signOut: signOut, setCookie: setCookie, url: SB_URL, anon: SB_ANON };
})();
