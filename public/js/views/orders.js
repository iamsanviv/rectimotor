import { db } from '../db.js';
import { esc, money, shortDate, badge, STATUS, OPEN, debounce, $ } from '../ui.js';

export function orderRow(o) {
  const cls = o.is_overdue ? 'late' : o.status === 'ready' ? 'ready' : '';
  const due = OPEN.includes(o.status)
    ? `<span class="${o.is_overdue ? 'late-text' : ''}">${o.is_overdue ? 'Retrasada · ' : 'Entrega: '}${shortDate(o.estimated_delivery_at)}</span>`
    : o.pending_return ? '<span class="late-text">Piezas por devolver</span>' : '';
  const bal = o.balance > 0 ? `<b class="fin-${o.financial_status}">${money(o.balance)}</b><span class="sub">saldo</span>` : '';
  return `<a class="row-card ${cls}" href="#/ot/${o.id}">
    <div class="main-col"><span class="code">${esc(o.code)}</span> · <b>${esc(o.customer_name)}</b>
      <span class="sub">${esc(o.brand)} ${esc(o.reference)}${o.plate ? ' · ' + esc(o.plate) : ''} · Mecánico: ${esc(o.mechanic_name)}</span></div>
    <div class="mid">${badge(o.status)}<span class="sub">${due}</span></div>
    <div class="end">${bal}</div>
  </a>`;
}

const PRESETS = {
  open: { statuses: OPEN, label: 'Abiertas' },
  quoting: { statuses: ['reception', 'diagnosis', 'awaiting_approval'], label: 'Por cotizar o aprobar' },
  working: { statuses: ['in_progress', 'quality_control'], label: 'En proceso y calidad' },
  ready: { statuses: ['ready'], label: 'Listas para entregar' },
  late: { statuses: OPEN, late: true, label: 'Retrasadas' },
};

export async function render(el, ctx) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const preset = PRESETS[qs.get('f')] || null;
  el.innerHTML = `
    <div class="page-head"><div><h1>Órdenes de trabajo</h1><p class="muted" id="count"></p></div>
      <a class="btn primary" href="#/nueva">＋ Nueva OT</a></div>
    <div class="toolbar">
      <input class="grow" id="q" placeholder="Buscar: número, cliente, cédula/NIT, teléfono, motor, placa, mecánico" autocomplete="off">
      <select id="st"><option value="">Todos los estados</option>
        <option value="__open" ${preset ? 'selected' : ''}>${preset ? esc(preset.label) : 'Abiertas'}</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <input type="date" id="from" aria-label="Recibidas desde">
      <input type="date" id="to" aria-label="Recibidas hasta">
    </div>
    <div class="list" id="list"><div class="loading">Cargando…</div></div>`;

  const load = async () => {
    const st = $('#st').value;
    const statuses = st === '__open' ? (preset?.statuses || OPEN) : st ? [st] : null;
    const from = $('#from').value ? new Date($('#from').value + 'T00:00:00-05:00').toISOString() : null;
    const to = $('#to').value ? new Date($('#to').value + 'T23:59:59-05:00').toISOString() : null;
    let rows = await db.orders({ statuses, search: $('#q').value.trim(), from, to });
    if (st === '__open' && preset?.late) rows = rows.filter((o) => o.is_overdue);
    $('#count').textContent = `${rows.length} resultado${rows.length === 1 ? '' : 's'}`;
    $('#list').innerHTML = rows.length ? rows.map(orderRow).join('') : '<div class="card empty"><b>Sin resultados</b>Prueba con otra búsqueda o filtro.</div>';
  };
  const dl = debounce(load, 300);
  $('#q').addEventListener('input', dl);
  ['st', 'from', 'to'].forEach((id) => $('#' + id).addEventListener('change', load));
  ctx.refresh = load;
  await load();
}
