import { adminUsers } from '../db.js';
import { esc, $, $$, modal, run } from '../ui.js';

export async function render(el, ctx) {
  const load = async () => {
    const { users } = await adminUsers('list');
    el.innerHTML = `<div class="page-head"><div><h1>Usuarios</h1><p class="muted">Solo el administrador crea usuarios, autoriza crédito, anula pagos y corrige estados.</p></div>
        <button class="btn primary" id="new">＋ Nuevo usuario</button></div>
      <div class="list">${users.map((u) => `<div class="row-card" style="cursor:default">
        <div><b>${esc(u.full_name)}</b><span class="sub">${esc(u.email || '')}</span></div>
        <div class="mid"><span class="badge ${u.role === 'admin' ? 'st-delivered' : 'st-in_progress'}">${u.role === 'admin' ? 'Administrador' : 'Técnico'}</span>
          ${u.active ? '' : '<span class="badge st-rejected">Inactivo</span>'}</div>
        <div class="end">${u.id === ctx.me.id ? '<span class="muted small">Tú</span>' : `<button class="btn" data-edit="${u.id}">Editar</button>`}</div></div>`).join('')}</div>`;
    $('#new', el).onclick = () => form();
    $$('[data-edit]', el).forEach((b) => b.onclick = () => form(users.find((u) => u.id === b.dataset.edit)));
  };
  const form = (u) => {
    const m = modal({
      title: u ? u.full_name : 'Nuevo usuario',
      body: `<label class="field"><span>Nombre <i>*</i></span><input id="n" value="${esc(u?.full_name || '')}"></label>
        ${u ? '' : '<label class="field"><span>Correo <i>*</i></span><input id="e" type="email"></label>'}
        <label class="field"><span>Rol</span><select id="r"><option value="technician">Técnico</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
        <label class="field"><span>${u ? 'Nueva contraseña (opcional)' : 'Contraseña temporal (mínimo 8)'}</span><input id="p" type="text" autocomplete="off"></label>
        ${u ? `<label class="check"><input type="checkbox" id="a" ${u.active ? 'checked' : ''}> Usuario activo</label>` : ''}
        <p class="hint">Entrega la contraseña a la persona. Puede cambiarla en "Mi cuenta".</p><div class="error" id="merr"></div>`,
      actions: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>',
    });
    $('#ok', m).onclick = () => {
      const full_name = $('#n', m).value.trim();
      const password = $('#p', m).value;
      if (!full_name) { $('#merr', m).textContent = 'Escribe el nombre.'; return; }
      if ((!u || password) && password.length < 8) { $('#merr', m).textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
      const payload = u
        ? { id: u.id, full_name, role: $('#r', m).value, active: $('#a', m).checked, password: password || undefined }
        : { email: $('#e', m).value.trim(), full_name, role: $('#r', m).value, password };
      if (!u && !payload.email) { $('#merr', m).textContent = 'Escribe el correo.'; return; }
      run($('#ok', m), () => adminUsers(u ? 'update' : 'create', payload), u ? 'Usuario actualizado' : 'Usuario creado')
        .then(() => { m.close(); load(); }).catch(() => {});
    };
  };
  await load();
}
