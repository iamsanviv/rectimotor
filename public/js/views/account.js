import { sb } from '../db.js';
import { esc, $, run } from '../ui.js';

export async function render(el, ctx) {
  el.innerHTML = `<div class="page-head"><div><h1>Mi cuenta</h1><p class="muted">${esc(ctx.me.full_name)} · ${esc(ctx.me.email || ctx.session.user.email)} · ${ctx.isAdmin ? 'Administrador' : 'Técnico'}</p></div></div>
    <div class="grid cols-2">
      <form class="card grid" id="pw"><h2>Cambiar contraseña</h2>
        <label class="field"><span>Nueva contraseña (mínimo 8)</span><input type="password" id="p1" minlength="8" autocomplete="new-password" required></label>
        <label class="field"><span>Repetir</span><input type="password" id="p2" autocomplete="new-password" required></label>
        <div class="error" id="err"></div><button class="btn primary">Guardar</button></form>
      <div class="card"><h2>Sesión</h2><p class="muted">La sesión queda abierta en este equipo hasta que salgas.</p>
        ${ctx.isAdmin ? '<a class="btn" href="#/usuarios" style="margin-bottom:10px">Usuarios</a><br>' : ''}
        <a class="btn" href="#/clientes" style="margin-bottom:10px">Clientes</a><br>
        <button class="btn danger" id="out">Cerrar sesión</button></div>
    </div>`;
  $('#pw').onsubmit = (e) => {
    e.preventDefault();
    const a = $('#p1').value, b = $('#p2').value;
    if (a.length < 8) { $('#err').textContent = 'Mínimo 8 caracteres.'; return; }
    if (a !== b) { $('#err').textContent = 'Las contraseñas no coinciden.'; return; }
    $('#err').textContent = '';
    run(e.target.querySelector('button'), async () => { const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error; }, 'Contraseña actualizada')
      .then(() => e.target.reset()).catch(() => {});
  };
  $('#out').onclick = () => sb.auth.signOut();
}
