// Detalle de la OT: siguiente paso, recepción, diagnóstico, cotización, pagos e historial.
import { db, rpc, uploadAttachment, signedUrls } from '../db.js';
import {
  esc, $, $$, money, date, dateTime, shortDate, badge, STATUS, FLOW, OPEN, FINANCIAL, FUEL, CHANNEL, METHOD,
  SECTION, EVENT, modal, toast, errMsg, run, photoInput, viewImage, parseMoney, todayISO,
} from '../ui.js';
import { messages, openWhatsApp } from '../whatsapp.js';
import { shareQuoteImage } from '../quote-image.js';

let state = { tab: 'resumen' };

export async function render(el, ctx) {
  const id = ctx.params.id;
  const [concepts, profiles, mechanics] = await Promise.all([db.concepts(), db.profiles(), db.mechanics()]);
  const conceptNames = Object.fromEntries(concepts.map((c) => [c.code, c.name]));
  const people = Object.fromEntries(profiles.map((p) => [p.id, p.full_name]));
  if (state.id !== id) state = { id, tab: 'resumen' };

  const load = async () => {
    const [o, d] = await Promise.all([db.order(id), db.orderDetail(id)]);
    const urls = await signedUrls(d.attachments.map((a) => a.storage_path));
    const S = { o, d, urls, concepts, conceptNames, people, mechanics, ctx, reload: load };
    S.sentQuote = d.quotes.find((q) => q.status === 'sent');
    S.approvedQuote = d.quotes.find((q) => q.status === 'approved');
    S.draftQuote = d.quotes.find((q) => q.status === 'draft');
    draw(el, S);
  };
  ctx.refresh = load;
  await load();
}

function draw(el, S) {
  const { o } = S;
  const idx = FLOW.indexOf(o.status);
  const steps = o.status === 'rejected'
    ? `<div class="done">Recepción</div><div class="done">Diagnóstico</div><div class="done">Cotización</div><div class="now">Rechazada</div><div class="${o.pending_return ? '' : 'done'}">Devolución</div>`
    : FLOW.map((s, i) => `<div class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${STATUS[s]}</div>`).join('');
  el.innerHTML = `
    <div class="page-head"><div>
        <a href="#/ordenes" class="muted small">‹ Órdenes</a>
        <h1>${esc(o.code)} · ${esc(o.customer_name)}</h1>
        <div class="muted">${esc(o.brand)} ${esc(o.reference)}${o.plate ? ' · ' + esc(o.plate) : ''} · Mecánico: ${esc(o.mechanic_name)} · Recibida ${dateTime(o.received_at)}</div>
      </div>
      <div style="text-align:right">${badge(o.status)}
        ${o.estimated_delivery_at && OPEN.includes(o.status) ? `<div class="small ${o.is_overdue ? 'late-text' : 'muted'}" style="margin-top:6px">${o.is_overdue ? 'Retrasada · ' : 'Entrega estimada: '}${shortDate(o.estimated_delivery_at)}</div>` : ''}
        ${o.billable != null ? `<div class="small" style="margin-top:4px">Saldo: <b class="fin-${o.financial_status}">${money(Math.max(0, o.balance))}</b> · ${esc(FINANCIAL[o.financial_status])}</div>` : ''}
      </div></div>
    <div class="steps">${steps}</div>
    <div class="card next" id="next" style="margin-top:14px"></div>
    <div class="tabs" role="tablist">
      ${[['resumen', 'Recepción'], ['diag', 'Diagnóstico'], ['quote', 'Cotización'], ['pay', 'Pagos y factura'], ['hist', 'Historial']]
        .map(([k, v]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${v}</button>`).join('')}
    </div>
    <div id="tab"></div>`;
  $$('.tabs button', el).forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; draw(el, S); });
  nextStep($('#next', el), S, el);
  const tabs = { resumen: tabReception, diag: tabDiagnosis, quote: tabQuote, pay: tabPayments, hist: tabHistory };
  tabs[state.tab]($('#tab', el), S, el);
}

const goTab = (el, S, tab) => { state.tab = tab; draw(el, S); $('#tab', el).scrollIntoView({ behavior: 'smooth' }); };

// ---------------------------------------------------------------- Siguiente paso
function nextStep(box, S, el) {
  const { o, sentQuote, approvedQuote, conceptNames } = S;
  const phone = o.customer_phone;
  const waBtn = (label, key) => `<button class="btn" data-wa="${key}">💬 ${label}</button>`;
  let html = '';
  switch (o.status) {
    case 'reception':
      html = `<h3>Siguiente paso: diagnóstico</h3><p>Lava las piezas y registra las mediciones.</p>
        <button class="btn primary" data-go="diag">Registrar diagnóstico</button>`; break;
    case 'diagnosis':
      html = `<h3>Siguiente paso: cotización</h3><p>Con las medidas listas, arma la cotización y envíala al cliente.</p>
        <div class="btn-row"><button class="btn primary" data-go="quote">Armar cotización</button><button class="btn" data-go="diag">Ver diagnóstico</button></div>`; break;
    case 'awaiting_approval':
      html = `<h3>Esperando la respuesta del cliente</h3>
        <p>Cotización v${sentQuote?.version} enviada por <b>${money(sentQuote?.total)}</b>. Registra aquí lo que responda.</p>
        <div class="btn-row">
          <button class="btn green" id="approve">✓ Cotización aprobada</button>
          <button class="btn danger" id="reject">Rechazada</button>
          ${waBtn('Enviar texto', 'quote')}<button class="btn" id="qimg">🖼 Imagen</button>
          <button class="btn ghost" id="withdraw">Retirar para corregir</button>
        </div>`; break;
    case 'in_progress':
      html = `<h3>En proceso</h3><p>Entrega estimada: <b>${shortDate(o.estimated_delivery_at)}</b>.</p>
        ${sentQuote ? `<p class="badge st-awaiting_approval">Adicional v${sentQuote.version} por ${money(sentQuote.total)} esperando aprobación</p>` : ''}
        <div class="btn-row">
          <button class="btn primary" id="toqc">Enviar a control de calidad</button>
          ${sentQuote ? '<button class="btn green" id="approve">✓ Adicional aprobado</button><button class="btn ghost" id="withdraw">Retirar adicional</button>' : '<button class="btn" data-go="quote">Cotizar adicional</button>'}
          <button class="btn" id="estimate">Cambiar fecha de entrega</button>
          ${waBtn('Confirmar aprobación', 'approved')}
        </div>`; break;
    case 'quality_control':
      html = `<h3>Control de calidad</h3><p>Revisa el trabajo terminado y registra el resultado.</p>
        <div class="btn-row"><button class="btn green" id="qcok">✓ Calidad aprobada</button><button class="btn danger" id="qcfail">No aprobada</button>
        <button class="btn" id="estimate">Cambiar fecha de entrega</button></div>`; break;
    case 'ready': {
      const needInv = o.customer_type === 'company' && !o.invoice_reference;
      html = `<h3>Listo para entregar</h3>
        <p>Valor: <b>${money(o.billable)}</b> · Pagado: <b>${money(o.paid)}</b> · Saldo: <b class="fin-${o.financial_status}">${money(Math.max(0, o.balance))}</b></p>
        ${needInv ? '<p class="error">Cliente empresa: registra la factura SIIGO antes de entregar (pestaña Pagos y factura).</p>' : ''}
        <div class="btn-row">${waBtn('Avisar que está listo', 'ready')}
          <button class="btn primary" id="deliver">Registrar entrega</button>
          <button class="btn" data-go="pay">Registrar pago</button></div>`; break;
    }
    case 'delivered':
      html = `<h3>${o.financial_status === 'settled' ? 'Entregado · Paz y salvo ✓' : 'Entregado · ' + esc(FINANCIAL[o.financial_status])}</h3>
        ${o.balance > 0 ? `<p>Saldo: <b class="fin-${o.financial_status}">${money(o.balance)}</b>${o.credit_due_on ? ` · vence ${date(o.credit_due_on + 'T12:00:00')}` : ''}</p>
          <div class="btn-row"><button class="btn primary" data-go="pay">Registrar pago</button>${waBtn('Recordar saldo', 'balance')}</div>` : '<p class="muted">Sin saldos pendientes.</p>'}`; break;
    case 'rejected':
      html = `<h3>Cotización rechazada</h3>
        <p>Liquidación: <b>${money(o.billable)}</b> · Pagado: <b>${money(o.paid)}</b>${o.balance > 0 ? ` · Saldo: <b class="fin-pending">${money(o.balance)}</b>` : ''}</p>
        <div class="btn-row">${o.pending_return ? '<button class="btn primary" id="return">Registrar devolución de piezas</button>' : '<span class="badge st-delivered">Piezas devueltas</span>'}
        ${o.balance > 0 ? '<button class="btn" data-go="pay">Registrar pago</button>' : ''}</div>`; break;
  }
  box.innerHTML = html;
  $$('[data-go]', box).forEach((b) => b.onclick = () => goTab(el, S, b.dataset.go));
  $$('[data-wa]', box).forEach((b) => b.onclick = () => {
    const k = b.dataset.wa;
    const text = k === 'quote' ? messages.quote(o, sentQuote, conceptNames) : messages[k](o);
    openWhatsApp(phone, text);
  });
  const on = (sel, fn) => { const b = $(sel, box); if (b) b.onclick = () => fn(b); };
  on('#qimg', (b) => run(b, () => shareQuoteImage(o, sentQuote, conceptNames)));
  on('#approve', () => approveModal(S));
  on('#reject', () => rejectModal(S));
  on('#withdraw', () => reasonModal('Retirar cotización', 'La cotización vuelve a borrador para corregirla.', (reason) =>
    rpc('quote_withdraw', { p_quote: sentQuote.id, p_reason: reason }), S, 'Cotización retirada'));
  on('#toqc', (b) => run(b, () => rpc('work_order_send_to_qc', { p_wo: o.id }), 'Enviada a control de calidad').then(S.reload).catch(() => {}));
  on('#qcok', (b) => run(b, () => rpc('quality_check_record', { p_wo: o.id, p_result: 'passed', p_notes: null }), 'Calidad aprobada: lista para entregar').then(S.reload).catch(() => {}));
  on('#qcfail', () => reasonModal('Calidad no aprobada', '¿Qué falló? El trabajo vuelve a proceso.', (notes) =>
    rpc('quality_check_record', { p_wo: o.id, p_result: 'failed', p_notes: notes }), S, 'Vuelve a proceso'));
  on('#estimate', () => estimateModal(S));
  on('#deliver', () => deliverModal(S));
  on('#return', () => returnModal(S));
}

// ---------------------------------------------------------------- Modales de acciones
function reasonModal(title, prompt, action, S, okMsg) {
  const m = modal({
    title, body: `<label class="field"><span>${esc(prompt)}</span><textarea id="reason"></textarea></label><div class="error" id="merr"></div>`,
    actions: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Confirmar</button>',
  });
  $('#ok', m).onclick = () => {
    const v = $('#reason', m).value.trim();
    if (!v) { $('#merr', m).textContent = 'Escribe el motivo.'; return; }
    run($('#ok', m), () => action(v), okMsg).then(() => { m.close(); S.reload(); }).catch(() => {});
  };
}

function approveModal(S) {
  const q = S.sentQuote;
  const m = modal({
    title: `Aprobar cotización v${q.version} · ${money(q.total)}`,
    body: `<label class="field"><span>¿Quién autorizó? <i>*</i></span><input id="who" value="${esc(S.o.mechanic_name)}"></label>
      <label class="field"><span>Canal</span><select id="ch">${Object.entries(CHANNEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="field"><span>Nota (opcional)</span><input id="note" placeholder="Ej.: aprobó por WhatsApp a las 10:32"></label>
      <div><span class="small" style="font-weight:600">Captura de WhatsApp (opcional)</span><div id="ev"></div></div>
      <p class="hint">${S.o.status === 'awaiting_approval' ? 'La fecha estimada de entrega se calcula en días hábiles (lunes a sábado, sin festivos).' : 'El nuevo total reemplaza al anterior.'}</p>
      <div class="error" id="merr"></div>`,
    actions: '<button class="btn" data-close>Cancelar</button><button class="btn green" id="ok">Registrar aprobación</button>',
  });
  const ev = photoInput($('#ev', m), { label: 'Adjuntar captura' });
  $('#ok', m).onclick = () => {
    const who = $('#who', m).value.trim();
    if (!who) { $('#merr', m).textContent = 'Indica quién autorizó.'; return; }
    run($('#ok', m), async () => {
      let evidence = null;
      const f = ev.getFiles()[0];
      if (f) evidence = (await uploadAttachment({ workOrderId: S.o.id, kind: 'approval_evidence', blob: f, uid: S.ctx.me.id })).id;
      await rpc('quote_approve', { p_quote: q.id, p_authorized_by: who, p_channel: $('#ch', m).value, p_note: $('#note', m).value.trim() || null, p_evidence: evidence });
    }, 'Aprobación registrada').then(() => { m.close(); S.reload(); }).catch(() => {});
  };
}

function rejectModal(S) {
  const q = S.sentQuote;
  const washing = q.quote_items.filter((i) => i.concept_code === 'washing').reduce((s, i) => s + Number(i.amount), 0);
  const m = modal({
    title: `Registrar rechazo · cotización v${q.version}`,
    body: `<label class="field"><span>¿Quién rechazó? <i>*</i></span><input id="who" value="${esc(S.o.mechanic_name)}"></label>
      <label class="field"><span>Canal</span><select id="ch">${Object.entries(CHANNEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <div class="card" style="box-shadow:none"><h3>¿Qué se cobra?</h3>
        <label class="check"><input type="checkbox" id="cw" ${washing ? 'checked' : ''}> Lavado de piezas</label>
        <input id="aw" inputmode="numeric" value="${washing || ''}" placeholder="Valor del lavado">
        <label class="check" style="margin-top:8px"><input type="checkbox" id="cd"> Diagnóstico</label>
        <input id="ad" inputmode="numeric" placeholder="Valor del diagnóstico">
        <p class="hint">Si no marcas nada, el rechazo queda sin cobro.</p></div>
      <label class="field"><span>Nota (opcional)</span><input id="note"></label>
      <div><span class="small" style="font-weight:600">Captura (opcional)</span><div id="ev"></div></div>
      <div class="error" id="merr"></div>`,
    actions: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="ok">Registrar rechazo</button>',
  });
  const ev = photoInput($('#ev', m), { label: 'Adjuntar captura' });
  $('#ok', m).onclick = () => {
    const who = $('#who', m).value.trim();
    const items = [];
    if ($('#cw', m).checked) items.push({ concept_code: 'washing', amount: parseMoney($('#aw', m).value) });
    if ($('#cd', m).checked) items.push({ concept_code: 'diagnosis', amount: parseMoney($('#ad', m).value) });
    if (!who) { $('#merr', m).textContent = 'Indica quién rechazó.'; return; }
    if (items.some((i) => i.amount <= 0)) { $('#merr', m).textContent = 'Escribe el valor de lo que se cobra, o desmárcalo.'; return; }
    run($('#ok', m), async () => {
      let evidence = null;
      const f = ev.getFiles()[0];
      if (f) evidence = (await uploadAttachment({ workOrderId: S.o.id, kind: 'approval_evidence', blob: f, uid: S.ctx.me.id })).id;
      await rpc('quote_reject', { p_quote: q.id, p_authorized_by: who, p_channel: $('#ch', m).value, p_settlement_items: items, p_note: $('#note', m).value.trim() || null, p_evidence: evidence });
    }, 'Rechazo registrado').then(() => { m.close(); S.reload(); }).catch(() => {});
  };
}

function estimateModal(S) {
  const cur = S.o.estimated_delivery_at ? new Date(new Date(S.o.estimated_delivery_at).getTime() - 5 * 3600e3).toISOString().slice(0, 16) : '';
  const m = modal({
    title: 'Cambiar fecha de entrega',
    body: `<label class="field"><span>Nueva fecha y hora</span><input type="datetime-local" id="at" value="${cur}"></label>
      <label class="field"><span>Motivo</span><input id="why" placeholder="Ej.: espera de repuesto"></label><div class="error" id="merr"></div>`,
    actions: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>',
  });
  $('#ok', m).onclick = () => {
    const v = $('#at', m).value;
    if (!v) { $('#merr', m).textContent = 'Elige la fecha.'; return; }
    run($('#ok', m), () => rpc('work_order_set_estimate', { p_wo: S.o.id, p_at: new Date(v + ':00-05:00').toISOString(), p_reason: $('#why', m).value.trim() || null }), 'Fecha actualizada')
      .then(() => { m.close(); S.reload(); }).catch(() => {});
  };
}

function deliverModal(S) {
  const { o } = S;
  const owes = o.balance > 0;
  const m = modal({
    title: `Entregar ${o.code}`,
    body: `<div class="money-line"><span>Valor</span><strong>${money(o.billable)}</strong></div>
      <div class="money-line"><span>Pagado</span><strong>${money(o.paid)}</strong></div>
      <div class="money-line"><span>Saldo</span><strong class="${owes ? 'fin-pending' : 'fin-settled'}">${money(Math.max(0, o.balance))}</strong></div>
      ${owes ? (o.credit_authorized
        ? '<label class="check"><input type="checkbox" id="credit"> Entregar con crédito (empresa autorizada)</label>'
        : '<p class="error">Hay saldo pendiente y el cliente no tiene crédito autorizado. Registra el pago antes de entregar.</p>') : '<p class="fin-settled">Queda a paz y salvo.</p>'}
      <label class="field"><span>¿Quién recibe? <i>*</i></span><input id="who" value="${esc(o.mechanic_name)}"></label>
      <label class="field"><span>Documento de quien recibe (opcional)</span><input id="wid" inputmode="numeric"></label>
      <label class="field"><span>Observaciones (opcional)</span><input id="note"></label>
      <div><span class="small" style="font-weight:600">Fotos de la entrega</span><div id="ph"></div></div>
      <div class="error" id="merr"></div>`,
    actions: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Registrar entrega y cerrar</button>',
  });
  const ph = photoInput($('#ph', m), { multiple: true, label: 'Tomar fotos' });
  $('#ok', m).onclick = () => {
    const who = $('#who', m).value.trim();
    if (!who) { $('#merr', m).textContent = 'Indica quién recibe.'; return; }
    run($('#ok', m), async () => {
      for (const blob of ph.getFiles()) await uploadAttachment({ workOrderId: o.id, kind: 'delivery_photo', blob, uid: S.ctx.me.id });
      const r = await rpc('work_order_deliver', { p_wo: o.id, p_received_by: who, p_received_by_id: $('#wid', m).value.trim() || null, p_use_credit: !!$('#credit', m)?.checked, p_notes: $('#note', m).value.trim() || null });
      toast(r === 'settled' ? 'Entregado · Paz y salvo' : 'Entregado con crédito pendiente');
    }).then(() => { m.close(); S.reload(); }).catch(() => {});
  };
}

function returnModal(S) {
  const m = modal({
    title: 'Devolución de piezas',
    body: `<label class="field"><span>¿Quién recibe las piezas? <i>*</i></span><input id="who" value="${esc(S.o.mechanic_name)}"></label>
      <label class="field"><span>Documento (opcional)</span><input id="wid"></label>
      <label class="field"><span>Observaciones (opcional)</span><input id="note"></label>
      <div><span class="small" style="font-weight:600">Fotos (opcional)</span><div id="ph"></div></div><div class="error" id="merr"></div>`,
    actions: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Registrar devolución</button>',
  });
  const ph = photoInput($('#ph', m), { multiple: true, label: 'Tomar fotos' });
  $('#ok', m).onclick = () => {
    const who = $('#who', m).value.trim();
    if (!who) { $('#merr', m).textContent = 'Indica quién recibe.'; return; }
    run($('#ok', m), async () => {
      for (const blob of ph.getFiles()) await uploadAttachment({ workOrderId: S.o.id, kind: 'delivery_photo', blob, uid: S.ctx.me.id });
      await rpc('work_order_return_parts', { p_wo: S.o.id, p_received_by: who, p_received_by_id: $('#wid', m).value.trim() || null, p_notes: $('#note', m).value.trim() || null });
    }, 'Devolución registrada').then(() => { m.close(); S.reload(); }).catch(() => {});
  };
}

// ---------------------------------------------------------------- Pestaña: recepción
function thumbs(S, list) {
  return list.length ? `<div class="thumbs">${list.map((a) => S.urls[a.storage_path]
    ? `<img src="${esc(S.urls[a.storage_path])}" data-full="${esc(S.urls[a.storage_path])}" alt="Foto">` : '').join('')}</div>` : '';
}

function tabReception(box, S) {
  const { o, d } = S;
  const open = OPEN.includes(o.status);
  const byPart = (pid) => d.attachments.filter((a) => a.received_part_id === pid);
  const deliveryPhotos = d.attachments.filter((a) => a.kind === 'delivery_photo');
  box.innerHTML = `
    <div class="grid cols-2">
      <div class="card"><h3>Cliente</h3>
        <div><b>${esc(o.customer_name)}</b> · ${o.customer_type === 'company' ? 'Empresa' : 'Particular'}</div>
        <div class="muted">${o.id_number ? esc(o.id_type + ' ' + o.id_number) : 'Sin documento'} · ${esc(o.customer_phone || 'Sin teléfono')}</div>
        <a class="small" href="#/clientes?id=${o.customer_id}">Editar datos del cliente</a></div>
      <div class="card"><h3>Motor</h3>
        <div><b>${esc(o.brand)} ${esc(o.reference)}</b></div>
        <div class="muted">Serie: ${esc(o.serial_number || '—')} · Placa: ${esc(o.plate || '—')}</div>
        <div class="muted">Mecánico: ${esc(o.mechanic_name)}${o.mechanic_phone ? ' · ' + esc(o.mechanic_phone) : ''}</div>
        ${open ? '<button class="btn" id="edit" style="margin-top:8px">Corregir recepción</button>' : ''}</div>
    </div>
    <div class="card"><h3>Piezas</h3><div class="grid cols-2">
      ${d.parts.map((p) => `<div class="part-card ${p.received ? '' : 'off'}">
        <b>${esc(p.part_types?.name || p.part_type)}</b> ${p.received ? '' : '<span class="muted">· no recibida</span>'}
        ${p.condition_notes ? `<div class="small">${esc(p.condition_notes)}</div>` : ''}
        ${thumbs(S, byPart(p.id))}
        ${p.received && open ? `<div data-add="${p.id}" style="margin-top:8px"></div>` : ''}
      </div>`).join('')}</div>
      ${d.wo.general_notes ? `<p><b>Observaciones:</b> ${esc(d.wo.general_notes)}</p>` : ''}
    </div>
    ${deliveryPhotos.length ? `<div class="card"><h3>Fotos de entrega / devolución</h3>${thumbs(S, deliveryPhotos)}</div>` : ''}`;
  $$('.thumbs img', box).forEach((img) => img.onclick = () => viewImage(img.dataset.full));
  $$('[data-add]', box).forEach((slot) => {
    photoInput(slot, {
      label: 'Agregar foto',
      onChange: async (files) => {
        await run(null, () => uploadAttachment({ workOrderId: o.id, kind: 'part_photo', blob: files[0], receivedPartId: slot.dataset.add, uid: S.ctx.me.id }), 'Foto agregada').catch(() => {});
        S.reload();
      },
    });
  });
  const eb = $('#edit', box);
  if (eb) eb.onclick = () => editReceptionModal(S);
}

async function editReceptionModal(S) {
  const { o, d } = S;
  const engine = await db.engine(d.wo.engine_id);
  const types = await db.partTypes();
  const byType = Object.fromEntries(d.parts.map((p) => [p.part_type, p]));
  const m = modal({
    title: 'Corregir recepción', wide: true,
    body: `<div class="form-grid">
      <label class="field"><span>Marca <i>*</i></span><input id="brand" value="${esc(engine.brand)}"></label>
      <label class="field"><span>Referencia <i>*</i></span><input id="ref" value="${esc(engine.reference)}"></label>
      <label class="field"><span>Mecánico</span><select id="mech">${S.mechanics.map((x) => `<option value="${x.id}" ${x.id === o.mechanic_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Serie</span><input id="serial" value="${esc(engine.serial_number || '')}"></label>
      <label class="field"><span>Placa</span><input id="plate" value="${esc(engine.plate || '')}"></label>
      <label class="field"><span>Combustible</span><select id="fuel">${Object.entries(FUEL).map(([k, v]) => `<option value="${k}" ${k === engine.fuel ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <div class="grid cols-2">${types.map((t) => `<div class="part-card"><label class="check"><input type="checkbox" data-pt="${t.code}" ${byType[t.code]?.received ? 'checked' : ''}> ${esc(t.name)}</label>
        <textarea data-pn="${t.code}" placeholder="Estado y observaciones">${esc(byType[t.code]?.condition_notes || '')}</textarea></div>`).join('')}</div>
      <label class="field"><span>Observaciones generales</span><textarea id="gn">${esc(d.wo.general_notes || '')}</textarea></label>`,
    actions: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>',
  });
  $('#ok', m).onclick = () => run($('#ok', m), () => rpc('work_order_update_reception', {
    p_wo: o.id, p_mechanic_id: $('#mech', m).value, p_brand: $('#brand', m).value, p_reference: $('#ref', m).value,
    p_serial: $('#serial', m).value || null, p_plate: $('#plate', m).value || null, p_fuel: $('#fuel', m).value,
    p_parts: types.filter((t) => byType[t.code] || $(`[data-pt="${t.code}"]`, m).checked).map((t) => ({
      part_type: t.code, received: $(`[data-pt="${t.code}"]`, m).checked, condition_notes: $(`[data-pn="${t.code}"]`, m).value.trim() || null,
    })),
    p_general_notes: $('#gn', m).value.trim() || null,
  }), 'Recepción corregida').then(() => { m.close(); S.reload(); }).catch(() => {});
}

// ---------------------------------------------------------------- Pestaña: diagnóstico
const NOTE_COL = { block: 'block_notes', crankshaft: 'crankshaft_notes', cylinder_head: 'head_notes', guides_valves: 'guides_notes' };

function tabDiagnosis(box, S) {
  const { o, d } = S;
  const editable = ['reception', 'diagnosis'].includes(o.status);
  const received = d.parts.filter((p) => p.received).map((p) => p.part_type);
  const sections = [...new Set([...received, ...(received.includes('cylinder_head') ? ['guides_valves'] : []), ...d.measurements.map((m) => m.section), 'other'])]
    .filter((s) => SECTION[s]);
  const rowsOf = (s) => d.measurements.filter((m) => m.section === s).sort((a, b) => a.point.localeCompare(b.point, 'es', { numeric: true }));

  if (!editable) {
    box.innerHTML = sections.map((s) => {
      const rows = rowsOf(s);
      const note = NOTE_COL[s] ? d.diagnosis?.[NOTE_COL[s]] : null;
      if (!rows.length && !note) return '';
      return `<div class="card"><h3>${SECTION[s]}</h3>${rows.length ? `<div class="measure">${rows.map((r) => `<div><span class="muted small">${esc(r.point)}</span><br><b>${r.value_mm != null ? Number(r.value_mm).toFixed(3) + ' mm' : '—'}</b>${r.notes ? `<div class="small">${esc(r.notes)}</div>` : ''}</div>`).join('')}</div>` : ''}
        ${note ? `<p>${esc(note)}</p>` : ''}</div>`;
    }).join('') || '<div class="card empty"><b>Sin diagnóstico registrado</b></div>';
    return;
  }

  box.innerHTML = `<p class="muted">Medidas en milímetros. No se aplican tolerancias automáticas.</p>
    ${sections.map((s) => `<div class="card" data-sec="${s}"><h3>${SECTION[s]}</h3>
      ${s === 'block' ? '<div class="btn-row" style="margin-bottom:10px"><label class="field" style="width:200px"><span>N.º de cilindros</span><input type="number" min="1" max="16" data-gen="cyl" value="' + (rowsOf('block').filter((r) => /^Cilindro \d+$/.test(r.point)).length || 4) + '"></label><button type="button" class="btn" data-genbtn="block" style="align-self:flex-end">Crear campos</button></div>' : ''}
      ${s === 'crankshaft' ? '<div class="btn-row" style="margin-bottom:10px"><label class="field" style="width:160px"><span>Muñones de bancada</span><input type="number" min="1" max="12" data-gen="main" value="5"></label><label class="field" style="width:160px"><span>Muñones de biela</span><input type="number" min="1" max="12" data-gen="rod" value="4"></label><button type="button" class="btn" data-genbtn="crankshaft" style="align-self:flex-end">Crear campos</button></div>' : ''}
      <div class="measure" data-rows></div>
      <div class="btn-row" style="margin-top:10px"><input data-newpoint placeholder="Nombre de otra medida" style="max-width:260px"><button type="button" class="btn" data-addpoint>＋ Agregar</button></div>
      ${NOTE_COL[s] ? `<label class="field" style="margin-top:10px"><span>Observaciones ${s === 'block' ? '(desgaste, ovalamiento, conicidad)' : s === 'cylinder_head' ? '(estado, fisuras, estanqueidad)' : ''}</span>
        <textarea data-note>${esc(d.diagnosis?.[NOTE_COL[s]] || '')}</textarea></label>` : ''}
    </div>`).join('')}
    <div class="btn-row"><button class="btn primary" id="saveDiag">Guardar diagnóstico</button></div>`;

  const addRow = (sec, point, value = '') => {
    const wrap = $(`[data-sec="${sec}"] [data-rows]`, box);
    if ($$('[data-point]', wrap).some((i) => i.dataset.point === point)) return;
    wrap.insertAdjacentHTML('beforeend', `<label class="field"><span>${esc(point)}</span>
      <input data-point="${esc(point)}" inputmode="decimal" value="${value ?? ''}" placeholder="mm"></label>`);
  };
  sections.forEach((s) => {
    rowsOf(s).forEach((r) => addRow(s, r.point, r.value_mm != null ? Number(r.value_mm) : ''));
    if (!rowsOf(s).length && s === 'cylinder_head') addRow(s, 'Planitud');
  });
  if (!rowsOf('block').length && sections.includes('block')) for (let i = 1; i <= 4; i++) addRow('block', `Cilindro ${i}`);
  $$('[data-genbtn]', box).forEach((b) => b.onclick = () => {
    const sec = b.dataset.genbtn;
    const card = $(`[data-sec="${sec}"]`, box);
    if (sec === 'block') for (let i = 1; i <= Number($('[data-gen=cyl]', card).value || 0); i++) addRow('block', `Cilindro ${i}`);
    if (sec === 'crankshaft') {
      for (let i = 1; i <= Number($('[data-gen=main]', card).value || 0); i++) addRow('crankshaft', `Bancada ${i}`);
      for (let i = 1; i <= Number($('[data-gen=rod]', card).value || 0); i++) addRow('crankshaft', `Biela ${i}`);
      addRow('crankshaft', 'Ovalamiento'); addRow('crankshaft', 'Conicidad');
    }
  });
  $$('[data-addpoint]', box).forEach((b) => b.onclick = () => {
    const card = b.closest('[data-sec]');
    const inp = $('[data-newpoint]', card);
    if (inp.value.trim()) { addRow(card.dataset.sec, inp.value.trim()); inp.value = ''; }
  });
  $('#saveDiag', box).onclick = () => {
    const notes = {};
    const meas = [];
    let bad = null;
    $$('[data-sec]', box).forEach((card) => {
      const s = card.dataset.sec;
      const n = $('[data-note]', card);
      if (n && NOTE_COL[s]) notes[NOTE_COL[s]] = n.value.trim() || null;
      $$('[data-point]', card).forEach((i) => {
        const raw = i.value.trim().replace(',', '.');
        if (raw && !(Number(raw) >= 0)) bad = `${SECTION[s]} · ${i.dataset.point}`;
        meas.push({ section: s, point: i.dataset.point, value_mm: raw });
      });
    });
    if (bad) { toast(`Valor no válido en ${bad}`, true); return; }
    run($('#saveDiag', box), () => rpc('diagnosis_save', { p_wo: o.id, p_notes: notes, p_measurements: meas }), 'Diagnóstico guardado').then(S.reload).catch(() => {});
  };
}

// ---------------------------------------------------------------- Pestaña: cotización
function tabQuote(box, S) {
  const { o, d, concepts, conceptNames, sentQuote, approvedQuote, draftQuote } = S;
  const canEdit = ['diagnosis', 'in_progress', 'quality_control'].includes(o.status) && !sentQuote;
  const base = draftQuote || (o.status !== 'diagnosis' ? approvedQuote : null) || d.quotes.filter((q) => q.kind === 'quote').slice(-1)[0];
  const list = d.quotes.slice().reverse().map((q) => `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>${q.kind === 'rejection_settlement' ? 'Liquidación por rechazo' : 'Cotización'} v${q.version}</b>
        <span class="badge ${({ draft: 'st-reception', sent: 'st-awaiting_approval', approved: 'st-ready', rejected: 'st-rejected', superseded: 'st-reception' })[q.status]}">${({ draft: 'Borrador', sent: 'Enviada', approved: q.kind === 'quote' ? 'Aprobada' : 'Vigente', rejected: 'Rechazada', superseded: 'Reemplazada' })[q.status]}</span></div>
      ${q.quote_items.map((i) => `<div class="money-line"><span>${esc(i.description || conceptNames[i.concept_code])}</span><span>${money(i.amount)}</span></div>`).join('')}
      <div class="money-line"><b>Total</b><strong>${money(q.total)}</strong></div>
      ${q.notes_for_customer ? `<p class="small">${esc(q.notes_for_customer)}</p>` : ''}
      <div class="muted small">${q.sent_at ? 'Enviada ' + dateTime(q.sent_at) : 'Creada ' + dateTime(q.created_at)}${q.valid_until ? ' · válida hasta ' + date(q.valid_until + 'T12:00:00') : ''}</div>
      ${q.status === 'sent' ? `<div class="btn-row" style="margin-top:8px"><button class="btn" data-qwa="${q.id}">💬 Enviar texto</button><button class="btn" data-qimg="${q.id}">🖼 Imagen</button></div>` : ''}
    </div>`).join('');

  const seedOthers = (base?.quote_items || []).filter((i) => i.concept_code === 'other');
  const editor = !canEdit ? '' : (() => {
    const amt = (code) => (base?.quote_items || []).filter((i) => i.concept_code === code).reduce((s, i) => s + Number(i.amount), 0);
    return `<div class="card"><h2>${o.status === 'diagnosis' ? 'Armar cotización' : 'Cotización adicional'}</h2>
      <p class="muted small">Valores en pesos con IVA y mano de obra incluidos. Deja en blanco lo que no aplica.</p>
      <table class="simple"><tbody>
        ${concepts.filter((c) => c.allowed_in_quote && c.code !== 'other').map((c) => `<tr><td>${esc(c.name)}</td>
          <td style="width:190px"><input data-c="${c.code}" inputmode="numeric" value="${amt(c.code) || ''}" placeholder="$ 0"></td></tr>`).join('')}
      </tbody></table>
      <h3 style="margin-top:14px">Otros trabajos</h3><div id="others"></div>
      <button type="button" class="btn" id="addOther">＋ Otro trabajo</button>
      <div class="money-line" style="margin-top:12px"><b>Total</b><span class="total" id="qt">$ 0</span></div>
      <div class="form-grid two">
        <label class="field"><span>Notas para el cliente</span><textarea id="qn">${esc(base?.notes_for_customer || '')}</textarea></label>
        <label class="field"><span>Válida hasta</span><input type="date" id="qv" value="${draftQuote?.valid_until || ''}" min="${todayISO()}"><span class="hint">Si lo dejas vacío: 8 días.</span></label>
      </div>
      <div class="error" id="qerr"></div>
      <div class="btn-row"><button class="btn" id="qsave">Guardar borrador</button><button class="btn primary" id="qsend">Guardar y marcar enviada</button></div>
    </div>`;
  })();

  box.innerHTML = (sentQuote && o.status === 'awaiting_approval' ? '<p class="muted">Para cambiar la cotización enviada, usa "Retirar para corregir" arriba.</p>' : '') +
    editor + (list ? `<h2 style="margin-top:18px">Versiones</h2>${list}` : '<div class="card empty"><b>Aún no hay cotizaciones</b></div>');

  $$('[data-qwa]', box).forEach((b) => b.onclick = () => openWhatsApp(o.customer_phone, messages.quote(o, d.quotes.find((q) => q.id === b.dataset.qwa), conceptNames)));
  $$('[data-qimg]', box).forEach((b) => b.onclick = () => run(b, () => shareQuoteImage(o, d.quotes.find((q) => q.id === b.dataset.qimg), conceptNames)));
  if (!canEdit) return;

  const othersBox = $('#others', box);
  const addOther = (desc = '', amount = '') => {
    othersBox.insertAdjacentHTML('beforeend', `<div class="btn-row" style="margin-bottom:8px" data-other>
      <input data-od placeholder="Descripción del trabajo" value="${esc(desc)}" style="flex:3 1 220px">
      <input data-oa inputmode="numeric" placeholder="$ 0" value="${amount || ''}" style="flex:1 1 120px">
      <button type="button" class="btn ghost" data-rm aria-label="Quitar">✕</button></div>`);
  };
  seedOthers.forEach((i) => addOther(i.description || '', Number(i.amount)));
  const collect = () => {
    const items = $$('[data-c]', box).map((i) => ({ concept_code: i.dataset.c, amount: parseMoney(i.value) })).filter((i) => i.amount > 0);
    $$('[data-other]', box).forEach((r) => {
      const a = parseMoney($('[data-oa]', r).value); const dsc = $('[data-od]', r).value.trim();
      if (a > 0 || dsc) items.push({ concept_code: 'other', description: dsc, amount: a });
    });
    return items;
  };
  const total = () => { $('#qt', box).textContent = money(collect().reduce((s, i) => s + i.amount, 0)); };
  box.addEventListener('input', total);
  othersBox.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { e.target.closest('[data-other]').remove(); total(); } });
  $('#addOther', box).onclick = () => addOther();
  total();

  const save = async (send) => {
    const items = collect();
    const err = !items.length ? 'Agrega al menos un valor.' : items.some((i) => i.concept_code === 'other' && (!i.description || i.amount <= 0)) ? 'Cada "Otro trabajo" necesita descripción y valor.' : '';
    $('#qerr', box).textContent = err;
    if (err) return;
    const btn = send ? $('#qsend', box) : $('#qsave', box);
    await run(btn, async () => {
      const qid = await rpc('quote_save_draft', { p_wo: o.id, p_items: items, p_notes: $('#qn', box).value.trim() || null, p_valid_until: $('#qv', box).value || null });
      if (send) await rpc('quote_send', { p_quote: qid });
    }, send ? 'Cotización marcada como enviada' : 'Borrador guardado').then(S.reload).catch(() => {});
  };
  $('#qsave', box).onclick = () => save(false);
  $('#qsend', box).onclick = () => save(true);
}

// ---------------------------------------------------------------- Pestaña: pagos y factura
function tabPayments(box, S) {
  const { o, d, ctx } = S;
  const active = d.payments.filter((p) => !p.voided_at);
  const invoice = d.invoices.find((i) => !i.voided_at);
  const canPay = o.status !== 'delivered' || o.balance > 0;
  box.innerHTML = `
    <div class="grid cols-2">
      <div class="card"><h3>Resumen</h3>
        <div class="money-line"><span>Valor a cobrar</span><strong>${o.billable != null ? money(o.billable) : 'Aún sin aprobar'}</strong></div>
        <div class="money-line"><span>Pagado</span><strong>${money(o.paid)}</strong></div>
        <div class="money-line"><span>Saldo</span><strong class="fin-${o.financial_status}">${o.billable != null ? money(o.balance) : '—'}</strong></div>
        <div class="money-line"><span>Estado</span><span class="fin-${o.financial_status}">${esc(FINANCIAL[o.financial_status])}</span></div>
        ${o.payment_terms === 'credit' ? `<div class="money-line"><span>Crédito vence</span><b>${date(o.credit_due_on + 'T12:00:00')}</b></div>` : ''}
      </div>
      <div class="card"><h3>Factura SIIGO</h3>
        ${invoice ? `<p>Referencia: <b>${esc(invoice.reference)}</b><br><span class="muted small">${dateTime(invoice.created_at)}</span></p>` : `<p class="muted">Sin factura registrada.${o.customer_type === 'company' ? ' <b>Obligatoria para entregar (empresa).</b>' : ''}</p>`}
        <div class="btn-row"><input id="inv" placeholder="Consecutivo SIIGO" style="flex:1 1 160px"><button class="btn" id="saveInv">${invoice ? 'Reemplazar' : 'Registrar'}</button></div>
        <p class="hint">Solo guarda la referencia. La factura se hace en SIIGO.</p></div>
    </div>
    ${canPay ? `<div class="card"><h3>Registrar pago o anticipo</h3>
      <div class="form-grid">
        <label class="field"><span>Valor <i>*</i></span><input id="pa" inputmode="numeric" placeholder="$ 0" value="${o.balance > 0 ? o.balance : ''}"></label>
        <label class="field"><span>Medio</span><select id="pm">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span>Referencia (opcional)</span><input id="pr" placeholder="N.º de transferencia"></label>
      </div>
      <div style="margin-top:10px"><span class="small" style="font-weight:600">Comprobante (opcional)</span><div id="pph"></div></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="pay">Registrar pago</button></div></div>` : ''}
    <div class="card"><h3>Pagos</h3>
      ${d.payments.length ? `<table class="simple"><thead><tr><th>Fecha</th><th>Medio</th><th>Valor</th><th></th></tr></thead><tbody>
        ${d.payments.map((p) => `<tr style="${p.voided_at ? 'opacity:.55;text-decoration:line-through' : ''}">
          <td>${dateTime(p.received_at)}<div class="muted small">${esc(S.people[p.recorded_by] || '')}${p.reference ? ' · ' + esc(p.reference) : ''}</div>
            ${p.voided_at ? `<div class="small" style="text-decoration:none">Anulado: ${esc(p.void_reason)}</div>` : ''}</td>
          <td>${METHOD[p.method]}</td><td><b>${money(p.amount)}</b></td>
          <td>${!p.voided_at && ctx.isAdmin ? `<button class="btn ghost danger" data-void="${p.id}">Anular</button>` : ''}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Sin pagos registrados.</p>'}
      ${active.length ? `<div class="money-line"><b>Total pagado</b><strong>${money(o.paid)}</strong></div>` : ''}
    </div>`;

  $('#saveInv', box).onclick = () => {
    const v = $('#inv', box).value.trim();
    if (!v) { toast('Escribe el consecutivo de la factura', true); return; }
    run($('#saveInv', box), () => rpc('invoice_record', { p_wo: o.id, p_reference: v }), 'Factura registrada').then(S.reload).catch(() => {});
  };
  if (canPay) {
    const pph = photoInput($('#pph', box), { label: 'Foto del comprobante' });
    $('#pay', box).onclick = () => {
      const amount = parseMoney($('#pa', box).value);
      if (amount <= 0) { toast('Escribe el valor del pago', true); return; }
      run($('#pay', box), async () => {
        let receipt = null;
        const f = pph.getFiles()[0];
        if (f) receipt = (await uploadAttachment({ workOrderId: o.id, kind: 'payment_receipt', blob: f, uid: ctx.me.id })).id;
        await rpc('payment_record', { p_wo: o.id, p_amount: amount, p_method: $('#pm', box).value, p_reference: $('#pr', box).value.trim() || null, p_receipt: receipt });
      }, 'Pago registrado').then(S.reload).catch(() => {});
    };
  }
  $$('[data-void]', box).forEach((b) => b.onclick = () => reasonModal('Anular pago', '¿Por qué se anula este pago?', (r) => rpc('payment_void', { p_payment: b.dataset.void, p_reason: r }), S, 'Pago anulado'));
}

// ---------------------------------------------------------------- Pestaña: historial
function tabHistory(box, S) {
  const { o, d, people, ctx } = S;
  const describe = (e) => {
    const x = e.details || {};
    if (e.event_type === 'status_change') return `${STATUS[e.from_status] || 'Inicio'} → <b>${STATUS[e.to_status]}</b>${x.authorized_by ? ` · autorizó ${esc(x.authorized_by)}` : ''}${x.notes ? ' · ' + esc(x.notes) : ''}${x.result === 'credit_pending' ? ' · con crédito pendiente' : x.result === 'settled' ? ' · paz y salvo' : ''}`;
    if (e.event_type === 'payment') return `${money(x.amount)} · ${METHOD[x.method] || ''}${x.kind === 'advance' ? ' (anticipo)' : ''}`;
    if (e.event_type === 'payment_voided') return `${money(x.amount)} · ${esc(x.reason)}`;
    if (e.event_type === 'estimate_changed') return `${shortDate(x.from)} → ${shortDate(x.to)}${x.reason ? ' · ' + esc(x.reason) : ''}`;
    if (e.event_type === 'quote_sent' || e.event_type === 'additional_approved') return `v${x.quote_version} · ${money(x.total)}`;
    if (e.event_type === 'invoice') return esc(x.reference);
    if (e.event_type === 'status_reverted' || e.event_type === 'quote_withdrawn') return `${x.reason ? esc(x.reason) : ''}`;
    if (e.event_type === 'parts_returned') return `Recibió ${esc(x.received_by)}`;
    return '';
  };
  const ev = d.attachments.filter((a) => a.kind === 'approval_evidence' || a.kind === 'payment_receipt');
  box.innerHTML = `<div class="card"><h3>Línea de tiempo</h3><div class="timeline">
      ${d.events.map((e) => `<div><b>${esc(EVENT[e.event_type] || e.event_type)}</b><span>${describe(e)}</span>
        <div class="muted small">${dateTime(e.created_at)} · ${esc(people[e.actor] || '—')}</div></div>`).join('')}
    </div></div>
    ${d.approvals.length ? `<div class="card"><h3>Autorizaciones</h3>${d.approvals.map((a) => `<div class="money-line"><span>${a.decision === 'approved' ? '✓ Aprobó' : '✕ Rechazó'} <b>${esc(a.authorized_by_name)}</b> por ${CHANNEL[a.channel]}${a.note ? ' · ' + esc(a.note) : ''}</span><span class="muted small">${dateTime(a.recorded_at)}</span></div>`).join('')}</div>` : ''}
    ${d.qcs.length ? `<div class="card"><h3>Control de calidad</h3>${d.qcs.map((q) => `<div class="money-line"><span>${q.result === 'passed' ? '✓ Aprobado' : '✕ No aprobado'}${q.notes ? ' · ' + esc(q.notes) : ''}</span><span class="muted small">${dateTime(q.checked_at)} · ${esc(people[q.checked_by] || '')}</span></div>`).join('')}</div>` : ''}
    ${d.handover ? `<div class="card"><h3>${d.handover.kind === 'delivery' ? 'Entrega' : 'Devolución'}</h3><p>Recibió <b>${esc(d.handover.received_by_name)}</b>${d.handover.received_by_id_number ? ' · ' + esc(d.handover.received_by_id_number) : ''} · ${dateTime(d.handover.handed_over_at)}${d.handover.notes ? '<br>' + esc(d.handover.notes) : ''}</p></div>` : ''}
    ${ev.length ? `<div class="card"><h3>Capturas y comprobantes</h3>${thumbs(S, ev)}</div>` : ''}
    ${ctx.isAdmin && OPEN.includes(o.status) ? `<div class="card"><h3>Corrección (administrador)</h3><p class="muted small">Solo para corregir errores. Queda registrado con el motivo.</p>
      <div class="btn-row"><select id="rv" style="max-width:260px">${OPEN.filter((s) => s !== o.status).map((s) => `<option value="${s}">${STATUS[s]}</option>`).join('')}</select><button class="btn danger" id="revert">Cambiar estado</button></div></div>` : ''}`;
  $$('.thumbs img', box).forEach((img) => img.onclick = () => viewImage(img.dataset.full));
  const rb = $('#revert', box);
  if (rb) rb.onclick = () => reasonModal('Corregir estado', `Pasar a "${STATUS[$('#rv', box).value]}". ¿Motivo?`, (r) => rpc('work_order_revert_status', { p_wo: o.id, p_to: $('#rv', box).value, p_reason: r }), S, 'Estado corregido');
}
