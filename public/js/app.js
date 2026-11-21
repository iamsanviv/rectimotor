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

const NAV = [
  ['tablero', '#/', '▦', 'Tablero'],
  ['nueva', '#/nueva', '＋', 'Nueva OT'],
  ['ordenes', '#/ordenes', '☰', 'Órdenes'],
  ['cartera', '#/cartera', '$', 'Cartera'],
  ['clientes', '#/clientes', '👤', 'Clientes'],
  ['usuarios', '#/usuarios', '⚙', 'Usuarios', true],
];

function shell() {
  const items = NAV.filter((n) => !n[4] || ctx.isAdmin);
  const mobile = items.filter((n) => ['tablero', 'nueva', 'ordenes', 'cartera'].includes(n[0])).concat([['cuenta', '#/cuenta', '●', 'Cuenta']]);
  $('#root').innerHTML = `<div class="app">
    <aside class="side">
      <div class="brand"><div class="brand-mark">RI</div><div><b>${esc(COMPANY.name)}</b><small>Órdenes de trabajo</small></div></div>
      <nav class="nav">${items.map((n) => `<a href="${n[1]}" data-nav="${n[0]}"><span class="ico">${n[2]}</span>${n[3]}</a>`).join('')}</nav>
      <div class="side-foot"><b>${esc(ctx.me.full_name)}</b><span class="muted">${ctx.isAdmin ? 'Administrador' : 'Técnico'}</span><br>
        <a href="#/cuenta" data-nav="cuenta">Mi cuenta</a></div>
    </aside>
    <main class="main">
      <div class="topbar"><div class="brand" style="padding:0"><div class="brand-mark" style="width:34px;height:34px">RI</div><b>${esc(COMPANY.name)}</b></div>
        ${ctx.isAdmin ? '<a class="btn ghost" href="#/usuarios">⚙</a>' : ''}</div>
      <div class="content" id="view"></div>
    </main>
    <nav class="tabbar">${mobile.map((n) => `<a href="${n[1]}" data-nav="${n[0]}"><span class="ico">${n[2]}</span>${n[3]}</a>`).join('')}</nav>
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
    <div class="brand" style="padding:0 0 14px"><div class="brand-mark">RI</div><div><b>${esc(COMPANY.name)}</b><small>Órdenes de trabajo</small></div></div>
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
