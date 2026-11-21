import { db, rpc } from '../db.js';
import { esc, $, $$, money, modal, run, debounce, ID_TYPES } from '../ui.js';

export async function render(el, ctx) {
  el.innerHTML = `<div class="page-head"><div><h1>Clientes</h1><p class="muted">Busca, corrige datos de facturación y, si eres administrador, autoriza crédito.</p></div></div>
    <div class="toolbar"><input class="grow" id="q" placeholder="Nombre, cédula/NIT o teléfono" autocomplete="off"></div>
    <div id="list" class="list"><div class="loading">Cargando…</div></div>`;
  const load = async () => {
    const rows = await db.customers($('#q').value.trim());
    $('#list').innerHTML = rows.length ? rows.map((c) => `<button class="row-card" style="text-align:left;cursor:pointer;font:inherit" data-id="${c.id}">
        <div><b>${esc(c.name)}</b><span class="sub">${c.customer_type === 'company' ? 'Empresa' : 'Particular'}${c.id_number ? ' · ' + esc(c.id_type + ' ' + c.id_number) : ''}</span></div>
        <div class="mid"><span class="sub">${esc(c.phone || 'Sin teléfono')}${c.email ? ' · ' + esc(c.email) : ''}</span></div>
        <div class="end">${c.credit_authorized ? `<span class="badge st-ready">Crédito ${c.credit_days} días</span>` : ''}</div></button>`).join('')
      : '<div class="card empty"><b>Sin clientes</b>Los clientes se crean al registrar una recepción.</div>';
    $$('[data-id]', el).forEach((b) => b.onclick = () => edit(rows.find((c) => c.id === b.dataset.id)));
  };
  const edit = (c) => {
    const m = modal({
      title: c.name,
      body: `<div class="form-grid two">
        <label class="field span-all"><span>Nombre o razón social <i>*</i></span><input id="name" value="${esc(c.name)}"></label>
        <label class="field"><span>Tipo</span><select id="type"><option value="individual">Particular</option><option value="company" ${c.customer_type === 'company' ? 'selected' : ''}>Empresa</option></select></label>
        <label class="field"><span>Tipo de documento</span><select id="idt"><option value="">Sin documento</option>${Object.entries(ID_TYPES).map(([k, v]) => `<option value="${k}" ${c.id_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Número</span><input id="idn" value="${esc(c.id_number || '')}"></label>
        <label class="field"><span>Teléfono / WhatsApp</span><input id="ph" value="${esc(c.phone || '')}" inputmode="tel"></label>
        <label class="field"><span>Dirección</span><input id="ad" value="${esc(c.address || '')}"></label>
        <label class="field"><span>Correo</span><input id="em" type="email" value="${esc(c.email || '')}"></label></div>
        ${ctx.isAdmin ? `<div class="card" style="box-shadow:none"><h3>Crédito (solo administrador)</h3>
          <label class="check"><input type="checkbox" id="cr" ${c.credit_authorized ? 'checked' : ''}> Crédito autorizado (solo empresas)</label>
          <div class="form-grid two"><label class="field"><span>Plazo (días)</span><input id="cd" type="number" min="1" value="${c.credit_days}"></label>
          <label class="field"><span>Cupo máximo (vacío = sin cupo)</span><input id="cl" inputmode="numeric" value="${c.credit_limit ?? ''}"></label></div>
          <button class="btn" id="saveCredit">Guardar crédito</button></div>` : ''}
        <div class="error" id="merr"></div>`,
      actions: '<button class="btn" data-close>Cerrar</button><button class="btn primary" id="ok">Guardar datos</button>',
    });
    $('#ok', m).onclick = () => {
      const name = $('#name', m).value.trim();
      const idn = $('#idn', m).value.trim();
      const idt = $('#idt', m).value;
      if (!name) { $('#merr', m).textContent = 'El nombre es obligatorio.'; return; }
      if (idn && !idt) { $('#merr', m).textContent = 'Elige el tipo de documento.'; return; }
      run($('#ok', m), () => db.updateCustomer(c.id, {
        name, customer_type: $('#type', m).value, id_type: idn ? idt : null, id_number: idn || null,
        phone: $('#ph', m).value.trim() || null, address: $('#ad', m).value.trim() || null, email: $('#em', m).value.trim() || null,
      }), 'Cliente actualizado').then(() => { m.close(); load(); }).catch(() => {});
    };
    const sc = $('#saveCredit', m);
    if (sc) sc.onclick = () => {
      const lim = $('#cl', m).value.replace(/\D/g, '');
      run(sc, () => rpc('customer_set_credit', { p_customer: c.id, p_authorized: $('#cr', m).checked, p_days: Number($('#cd', m).value) || 30, p_limit: lim ? Number(lim) : null }),
        'Crédito actualizado').then(() => { m.close(); load(); }).catch(() => {});
    };
  };
  $('#q').addEventListener('input', debounce(load, 300));
  await load();
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  if (want) edit(await db.customer(want));
}
