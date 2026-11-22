// Arranque, sesión, menú y rutas.
import { sb, db, adminUsers } from './db.js';
import { esc, toast, errMsg, run, $, debounce } from './ui.js';
import { COMPANY } from './config.js';

export const ctx = { session: null, me: null, isAdmin: false, route: '', params: {}, refresh: null };

const ROUTES = [
  { path: /^\/?$/, view: () => import('./views/dashboard.js'), nav: 'tablero' },
  { path: /^\/ordenes$/, view: () => import('./views/orders.js'), nav: 'ordenes' },
  { path: /^\/nueva$/, view: () => import('./views/intake.js'), nav: 'nueva' },
  { path: /^\/ot\/([0-9a-f-]{36})$/, view: () => import('./views/order.js'), nav: 'ordenes', keys: ['id'] },
  { path: /^\/cartera$/, view: () => import('./views/cartera.js'), nav: 'cartera' },
  { path: /^\/clientes$/, view: () => import('./views/customers.js'), nav: 'clientes' },
  { path: /^\/usuarios$/, view: () => import('./views/users.js'), nav: 'usuarios', admin: true },
  { path: /^\/cuenta$/, view: () => import('./views/account.js'), nav: 'cuenta' },
];

const ICON = {
  tablero: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  nueva: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  ordenes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  cartera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  clientes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  usuarios: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  cuenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};

const NAV = [
  ['tablero', '#/', 'Tablero'],
  ['nueva', '#/nueva', 'Nueva OT'],
  ['ordenes', '#/ordenes', 'Órdenes'],
  ['cartera', '#/cartera', 'Cartera'],
  ['clientes', '#/clientes', 'Clientes'],
  ['usuarios', '#/usuarios', 'Usuarios', true],
];

const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function shell() {
  const items = NAV.filter((n) => !n[3] || ctx.isAdmin);
  const tab = (key, href, label) => `<a href="${href}" data-nav="${key}">${ICON[key]}${label}</a>`;
  $('#root').innerHTML = `<div class="app">
    <aside class="side">
      <a class="logo-plate" href="#/"><img src="/img/logo-emblem.jpg" alt="${esc(COMPANY.name)}" width="196" height="94"><small>Rectificadora Diésel y Gasolina</small></a>
      <nav class="nav">${items.map((n) => tab(n[0], n[1], n[2])).join('')}</nav>
      <a class="side-foot" href="#/cuenta" data-nav="cuenta"><span class="avatar">${esc(initials(ctx.me.full_name))}</span>
        <div><b>${esc(ctx.me.full_name)}</b><span>${ctx.isAdmin ? 'Administrador' : 'Técnico'} · Mi cuenta</span></div></a>
    </aside>
    <main class="main">
      <div class="topbar"><a class="logo-plate" href="#/"><img src="/img/logo-emblem.jpg" alt="${esc(COMPANY.name)}" width="96" height="46"></a>
        <a class="avatar" href="#/cuenta" style="text-decoration:none">${esc(initials(ctx.me.full_name))}</a></div>
      <div class="content" id="view"></div>
    </main>
    <nav class="tabbar">
      ${tab('tablero', '#/', 'Tablero')}${tab('ordenes', '#/ordenes', 'Órdenes')}
      <a href="#/nueva" data-nav="nueva" aria-label="Nueva orden de trabajo"><span class="fab">${ICON.nueva}</span></a>
      ${tab('cartera', '#/cartera', 'Cartera')}${tab('cuenta', '#/cuenta', 'Cuenta')}
    </nav>
  </div>`;
}

async function route() {
  const hash = (location.hash.replace(/^#/, '') || '/').split('?')[0] || '/';
  const r = ROUTES.find((x) => x.path.test(hash)) || ROUTES[0];
  if (r.admin && !ctx.isAdmin) { location.hash = '#/'; return; }
  const m = hash.match(r.path) || [];
  ctx.params = Object.fromEntries((r.keys || []).map((k, i) => [k, m[i + 1]]));
  ctx.route = hash;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.nav));
  const el = $('#view');
  el.innerHTML = '<div class="loading">Cargando…</div>';
  window.scrollTo(0, 0);
  try {
    const mod = await r.view();
    ctx.refresh = null;
    await mod.render(el, ctx);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="card empty"><b>No se pudo cargar</b>${esc(errMsg(e))}<br><br><button class="btn" onclick="location.reload()">Reintentar</button></div>`;
  }
}

// Tiempo real: cuando otro equipo cambia una OT, se refresca la vista actual.
let channel;
function subscribeRealtime() {
  channel?.unsubscribe();
  const refresh = debounce(() => { if (ctx.refresh) ctx.refresh(); }, 600);
  channel = sb.channel('ot-events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_order_events' }, refresh)
    .subscribe();
}

function loginView(firstRun) {
  $('#root').innerHTML = `<div class="login-wrap"><div class="card login">
    <img class="login-logo" src="/img/logo.jpg" alt="${esc(COMPANY.name)}" width="300" height="300">
    ${firstRun ? `<h2>Crear el administrador</h2><p class="muted small">Aún no hay usuarios. Esta cuenta será la del administrador.</p>
      <form id="f" class="grid">
        <label class="field"><span>Nombre</span><input name="full_name" required autocomplete="name"></label>
        <label class="field"><span>Correo</span><input name="email" type="email" required autocomplete="username"></label>
        <label class="field"><span>Contraseña (mínimo 8)</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn primary block">Crear y entrar</button></form>`
    : `<h2>Iniciar sesión</h2>
      <form id="f" class="grid">
        <label class="field"><span>Correo</span><input name="email" type="email" required autocomplete="username"></label>
        <label class="field"><span>Contraseña</span><input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn primary block">Entrar</button></form>`}
  </div></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button');
    await run(btn, async () => {
      if (firstRun) await adminUsers('bootstrap', { full_name: f.full_name, email: f.email, password: f.password });
      const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
      if (error) throw error;
    }).catch(() => {});
  });
}

async function start(session) {
  ctx.session = session;
  if (!session) {
    let firstRun = false;
    try { firstRun = (await adminUsers('status')).needs_bootstrap; } catch { /* sin conexión: mostrar login normal */ }
    loginView(firstRun);
    return;
  }
  try {
    ctx.me = await db.me(session.user.id);
  } catch (e) { toast(errMsg(e), true); }
  if (!ctx.me || !ctx.me.active) {
    $('#root').innerHTML = `<div class="login-wrap"><div class="card login empty"><b>Tu usuario no está activo</b>
      Pide al administrador que te dé acceso.<br><br><button class="btn" id="out">Salir</button></div></div>`;
    $('#out').onclick = () => sb.auth.signOut();
    return;
  }
  ctx.isAdmin = ctx.me.role === 'admin';
  shell();
  subscribeRealtime();
  route();
}

let currentUser = undefined;
sb.auth.onAuthStateChange((event, session) => {
  const uid = session?.user?.id ?? null;
  if (uid === currentUser && event !== 'SIGNED_OUT') { ctx.session = session; return; }
  currentUser = uid;
  start(session);
});
window.addEventListener('hashchange', () => { if (ctx.me) route(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
