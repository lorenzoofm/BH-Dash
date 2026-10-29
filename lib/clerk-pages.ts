// Standalone pages the worker serves without a session: sign in, sign out, and "not approved".
// They load Clerk's browser SDK from the instance's own Frontend API, so no extra hosts are involved.
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));

// Only same-site paths, so the redirect can never send someone elsewhere.
export function safeReturn(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/sign-') ? value : '/';
}

function page(title: string, body: string, script: string, host: string, key: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · 20MG BH Operations</title><link rel="icon" href="/20mg.png">
<style>
@font-face{font-family:Archivo;src:url(/fonts/archivo-latin.woff2) format("woff2");font-weight:400 800;font-display:swap}
@font-face{font-family:"Space Mono";src:url(/fonts/space-mono-400-latin.woff2) format("woff2");font-display:swap}
:root{--paper:#f4f1ea;--card:#fbf9f5;--ink:#0a0a0a;--muted:#69655e;--faint:#e7e3dc;--signal:#ff3000}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:var(--paper);color:var(--ink);font:15px/1.55 Archivo,system-ui,sans-serif;-webkit-font-smoothing:antialiased;display:grid;place-items:center;min-height:100vh;padding:24px 16px}
main{width:100%;max-width:420px}
.brand{display:flex;align-items:baseline;gap:12px;margin-bottom:40px}
.mark{font-size:44px;font-weight:800;letter-spacing:-.07em;line-height:1}
.name{font:11px "Space Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
h1{font-size:40px;font-weight:800;letter-spacing:-.045em;line-height:.95;margin:0 0 12px}
p{color:var(--muted);margin:0 0 28px}
.btn{display:inline-flex;align-items:center;height:44px;padding:0 20px;border-radius:999px;background:var(--ink);color:var(--paper);font-weight:600;font-size:13px;text-decoration:none;border:0;cursor:pointer}
#clerk{min-height:200px}
.status{font-size:13px;color:var(--muted)}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--signal);margin-right:8px;vertical-align:middle}
</style></head><body><main>
<div class="brand"><span class="mark">20</span><span class="name">BH Operations</span></div>
${body}
</main>
<script>${script}</script>
<!-- After the inline script, so start() exists however fast this loads from cache. -->
<script async crossorigin="anonymous" data-clerk-publishable-key="${esc(key)}" src="https://${esc(host)}/npm/@clerk/clerk-js@5/dist/clerk.browser.js" onload="start()"></script>
</body></html>`;
}

const appearance = `{variables:{colorPrimary:'#0a0a0a',colorText:'#0a0a0a',colorTextSecondary:'#69655e',colorBackground:'#fbf9f5',colorInputBackground:'#fbf9f5',fontFamily:'Archivo, system-ui, sans-serif',borderRadius:'10px'},elements:{card:{boxShadow:'0 1px 2px #0a0a0a0a, 0 8px 24px -12px #0a0a0a14',border:'1px solid #e7e3dc',borderRadius:'20px'},formButtonPrimary:{borderRadius:'999px'},socialButtonsBlockButton:{borderRadius:'999px',height:'44px'},footer:{display:'none'},header:{display:'none'}}}`;

export function signInPage(host: string, key: string, target: string) {
  return page('Sign in',
    `<h1>Sign in</h1><p>Use the Google account your administrator approved.</p><div id="clerk"><span class="status"><span class="dot"></span>Loading sign-in…</span></div>`,
    `const target=${JSON.stringify(target)};
async function start(){
  await Clerk.load();
  // Already signed in: Clerk has just refreshed the session cookie, so go straight back.
  if(Clerk.session){await Clerk.session.getToken();location.replace(target);return;}
  const el=document.getElementById('clerk');el.textContent='';
  Clerk.mountSignIn(el,{forceRedirectUrl:target,signUpForceRedirectUrl:target,appearance:${appearance}});
}`, host, key);
}

export function signOutPage(host: string, key: string) {
  return page('Signed out',
    `<h1>Signing out</h1><p class="status"><span class="dot"></span>One moment…</p>`,
    `async function start(){await Clerk.load();await Clerk.signOut();location.replace('/sign-in');}`, host, key);
}

export function notApprovedPage(host: string, key: string, email: string) {
  return page('Not approved',
    `<h1>Not approved yet</h1><p>${esc(email)} is signed in but isn’t on the BH manager list. Ask an administrator to add this email, then sign in again.</p><a class="btn" href="/sign-out">Sign out</a>`,
    `function start(){}`, host, key);
}
