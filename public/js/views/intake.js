// Recepción: cliente (reutilizable), mecánico, motor, piezas con foto y estado.
import { db, rpc, uploadAttachment } from '../db.js';
import { esc, $, $$, toast, errMsg, run, debounce, photoInput, ID_TYPES, FUEL } from '../ui.js';

export async function render(el, ctx) {
  const [mechanics, partTypes] = await Promise.all([db.mechanics(), db.partTypes()]);
  let customer = null;
  const photos = {};

  el.innerHTML = `
    <div class="page-head"><div><h1>Nueva orden de trabajo</h1><p class="muted">La fecha y hora de recepción se guardan solas.</p></div></div>
    <form id="f" class="grid" novalidate>
      <section class="card"><h2>1. Cliente</h2>
        <div id="cust-pick">
          <label class="field"><span>Buscar cliente existente</span><input id="cq" placeholder="Nombre, cédula/NIT o teléfono" autocomplete="off"></label>
          <div id="cres"></div>
          <div class="btn-row" style="margin-top:10px"><button type="button" class="btn" id="new-cust">＋ Cliente nuevo</button></div>
        </div>
        <div id="cust-chosen" class="hidden"></div>
        <div id="cust-new" class="hidden" style="margin-top:12px">
          <div class="form-grid">
            <label class="field span-all"><span>Nombre o razón social <i>*</i></span><input name="c_name"></label>
            <label class="field"><span>Tipo de cliente</span><select name="c_type"><option value="individual">Particular</option><option value="company">Empresa</option></select></label>
            <label class="field"><span>Tipo de documento</span><select name="c_idtype"><option value="">Sin documento</option>${Object.entries(ID_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label class="field"><span>Número de documento</span><input name="c_idnum" inputmode="numeric"></label>
            <label class="field"><span>Teléfono / WhatsApp</span><input name="c_phone" inputmode="tel" placeholder="3001234567"></label>
            <label class="field"><span>Dirección</span><input name="c_address"></label>
            <label class="field"><span>Correo</span><input name="c_email" type="email"></label>
          </div>
          <p class="hint">Solo el nombre es obligatorio. Los demás datos se pueden completar antes de facturar.</p>
        </div>
      </section>

      <section class="card"><h2>2. Motor y mecánico</h2>
        <div class="form-grid">
          <label class="field"><span>Marca <i>*</i></span><input name="brand" placeholder="Cummins, Chevrolet…"></label>
          <label class="field"><span>Referencia / modelo <i>*</i></span><input name="reference" placeholder="ISF 2.8, 4BT…"></label>
          <label class="field"><span>Mecánico que entrega <i>*</i></span>
            <select name="mechanic"><option value="">Seleccionar…</option>${mechanics.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}<option value="__new">＋ Mecánico nuevo</option></select></label>
          <label class="field hidden" id="mnew-name"><span>Nombre del mecánico <i>*</i></span><input name="m_name"></label>
          <label class="field hidden" id="mnew-phone"><span>Teléfono del mecánico</span><input name="m_phone" inputmode="tel"></label>
          <label class="field"><span>Número de serie</span><input name="serial"></label>
          <label class="field"><span>Placa</span><input name="plate" style="text-transform:uppercase"></label>
          <label class="field"><span>Combustible</span><select name="fuel">${Object.entries(FUEL).map(([k, v]) => `<option value="${k}" ${k === 'unspecified' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
      </section>

      <section class="card"><h2>3. Piezas recibidas</h2>
        <p class="muted small">Marca cada pieza que entra, toma una foto y describe cómo llega.</p>
        <div class="grid cols-2" id="parts">${partTypes.map((p) => `
          <div class="part-card off" data-part="${p.code}">
            <label class="check"><input type="checkbox" name="p_${p.code}"> ${esc(p.name)}</label>
            <div class="part-body hidden">
              <div data-photo="${p.code}"></div>
              <label class="field" style="margin-top:10px"><span>Estado y observaciones</span><textarea name="pn_${p.code}" placeholder="Golpes, desgaste, faltantes…"></textarea></label>
            </div>
          </div>`).join('')}</div>
      </section>

      <section class="card"><h2>4. Observaciones generales</h2>
        <textarea name="notes" placeholder="Accesorios entregados, piezas faltantes, condiciones especiales…"></textarea>
      </section>

      <div id="err" class="error"></div>
      <div class="btn-row"><a class="btn" href="#/">Cancelar</a><button class="btn primary" id="save">Guardar recepción y crear OT</button></div>
    </form>`;

  // Partes
  $$('.part-card', el).forEach((card) => {
    const code = card.dataset.part;
    const cb = card.querySelector('input[type=checkbox]');
    photos[code] = photoInput(card.querySelector(`[data-photo="${code}"]`), { label: 'Foto de la pieza' });
    cb.addEventListener('change', () => {
      card.classList.toggle('off', !cb.checked);
      card.querySelector('.part-body').classList.toggle('hidden', !cb.checked);
    });
  });

  // Mecánico nuevo
  const mSel = el.querySelector('[name=mechanic]');
  mSel.addEventListener('change', () => {
    const n = mSel.value === '__new';
    $('#mnew-name').classList.toggle('hidden', !n);
    $('#mnew-phone').classList.toggle('hidden', !n);
  });

  // Cliente: búsqueda y selección
  const showChosen = () => {
    $('#cust-pick').classList.toggle('hidden', !!customer);
    $('#cust-new').classList.add('hidden');
    $('#cust-chosen').classList.toggle('hidden', !customer);
    if (customer) {
      $('#cust-chosen').innerHTML = `<div class="chosen"><div><b>${esc(customer.name)}</b><br><span class="muted small">
        ${customer.id_number ? esc(customer.id_type + ' ' + customer.id_number) + ' · ' : ''}${esc(customer.phone || 'Sin teléfono')}</span></div>
        <button type="button" class="btn" id="change">Cambiar</button></div>`;
      $('#change').onclick = () => { customer = null; showChosen(); $('#cq').focus(); };
    }
  };
  const search = debounce(async () => {
    const q = $('#cq').value.trim();
    if (q.length < 2) { $('#cres').innerHTML = ''; return; }
    try {
      const rows = await db.customers(q);
      $('#cres').innerHTML = rows.length
        ? `<div class="result-list">${rows.map((c) => `<button type="button" data-id="${c.id}"><b>${esc(c.name)}</b><br>
            <span class="muted small">${c.id_number ? esc(c.id_type + ' ' + c.id_number) + ' · ' : ''}${esc(c.phone || '')}</span></button>`).join('')}</div>`
        : '<p class="hint">No hay coincidencias. Crea el cliente nuevo.</p>';
      $$('#cres button').forEach((b) => b.onclick = () => { customer = rows.find((c) => c.id === b.dataset.id); showChosen(); });
    } catch (e) { toast(errMsg(e), true); }
  }, 300);
  $('#cq').addEventListener('input', search);
  $('#new-cust').onclick = () => { $('#cust-new').classList.remove('hidden'); el.querySelector('[name=c_name]').value = $('#cq').value; el.querySelector('[name=c_name]').focus(); };

  // Guardar
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const errs = [];
    const newCust = !customer && !$('#cust-new').classList.contains('hidden');
    if (!customer && !(newCust && f.c_name?.trim())) errs.push('Selecciona o crea el cliente.');
    if (newCust && f.c_idnum?.trim() && !f.c_idtype) errs.push('Elige el tipo de documento.');
    if (!f.brand?.trim()) errs.push('Falta la marca del motor.');
    if (!f.reference?.trim()) errs.push('Falta la referencia del motor.');
    if (!f.mechanic || (f.mechanic === '__new' && !f.m_name?.trim())) errs.push('Falta el mecánico que entrega.');
    const parts = $$('.part-card', el).map((c) => ({
      part_type: c.dataset.part,
      received: c.querySelector('input[type=checkbox]').checked,
      condition_notes: (f['pn_' + c.dataset.part] || '').trim() || null,
    }));
    if (!parts.some((p) => p.received)) errs.push('Marca al menos una pieza recibida.');
    $('#err').innerHTML = errs.map(esc).join('<br>');
    if (errs.length) { $('#err').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    await run($('#save'), async () => {
      let cust = customer;
      if (!cust) {
        cust = await db.createCustomer({
          name: f.c_name.trim(), customer_type: f.c_type,
          id_type: f.c_idnum?.trim() ? f.c_idtype : null, id_number: f.c_idnum?.trim() || null,
          phone: f.c_phone?.trim() || null, address: f.c_address?.trim() || null, email: f.c_email?.trim() || null,
          created_by: ctx.me.id,
        });
        customer = cust;
      }
      let mechanicId = f.mechanic;
      if (mechanicId === '__new') {
        const m = await db.createMechanic({ name: f.m_name.trim(), phone: f.m_phone?.trim() || null });
        mechanicId = m.id;
        mSel.insertAdjacentHTML('afterbegin', `<option value="${m.id}">${esc(m.name)}</option>`);
        mSel.value = m.id;
      }
      const woId = await rpc('work_order_create', {
        p_customer_id: cust.id, p_mechanic_id: mechanicId, p_brand: f.brand, p_reference: f.reference,
        p_serial: f.serial || null, p_plate: f.plate || null, p_fuel: f.fuel, p_parts: parts, p_general_notes: f.notes || null,
      });
      // Fotos (si alguna falla, la OT ya quedó creada y se puede volver a subir desde el detalle)
      const rp = (await db.orderDetail(woId)).parts;
      let failed = 0;
      for (const p of rp) {
        for (const blob of photos[p.part_type]?.getFiles() || []) {
          try { await uploadAttachment({ workOrderId: woId, kind: 'part_photo', blob, receivedPartId: p.id, uid: ctx.me.id }); }
          catch (err) { console.error(err); failed++; }
        }
      }
      if (failed) toast(`OT creada, pero ${failed} foto(s) no se subieron. Agrégalas desde el detalle.`, true);
      else toast('Recepción guardada');
      location.hash = `#/ot/${woId}`;
    }).catch(() => {});
  });
}
