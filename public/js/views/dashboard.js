import { db } from '../db.js';
import { esc, money, OPEN } from '../ui.js';
import { orderRow } from './orders.js';

const TZ = 'America/Bogota';
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const dayLabel = (key) => new Date(key + 'T12:00:00-05:00').toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric' });

export async function render(el, ctx) {
  const load = async () => {
    const all = await db.orders({ limit: 500 });
    const open = all.filter((o) => OPEN.includes(o.status));
    const late = open.filter((o) => o.is_overdue);
    const ready = open.filter((o) => o.status === 'ready');
    const quoting = open.filter((o) => ['reception', 'diagnosis', 'awaiting_approval'].includes(o.status));
    const working = open.filter((o) => ['in_progress', 'quality_control'].includes(o.status));
    const receivable = all.filter((o) => ['pending', 'credit_current', 'credit_overdue'].includes(o.financial_status) && o.balance > 0);
    const toCollect = receivable.reduce((s, o) => s + Number(o.balance || 0), 0);
    const inCredit = receivable.filter((o) => o.financial_status !== 'pending').reduce((s, o) => s + Number(o.balance || 0), 0);
    const returns = all.filter((o) => o.pending_return);

    // Entregas estimadas de los próximos 7 días
    const today = dayKey(new Date());
    const week = {};
    for (const o of open) {
      if (!o.estimated_delivery_at || o.is_overdue) continue;
      const k = dayKey(o.estimated_delivery_at);
      if (k >= today && k <= dayKey(Date.now() + 7 * 864e5)) week[k] = (week[k] || 0) + 1;
    }
    const weekRows = Object.keys(week).sort();

    const prio = (o) => (o.is_overdue ? 0 : o.status === 'ready' ? 1 : o.pending_return ? 2 : 3);
    const list = [...open, ...returns].sort((a, b) => prio(a) - prio(b)
      || new Date(a.estimated_delivery_at || '2999-01-01') - new Date(b.estimated_delivery_at || '2999-01-01'));
    const fecha = new Date().toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

    el.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">${esc(fecha)}</div><h1>Tablero del taller</h1></div>
        <a class="btn primary hide-sm" href="#/nueva">＋ Nueva orden de trabajo</a></div>
      <div class="kpis">
        <a class="kpi" href="#/ordenes?f=open"><span>OT abiertas</span><strong>${open.length}</strong></a>
        <a class="kpi" href="#/ordenes?f=quoting"><span>Por cotizar o aprobar</span><strong>${quoting.length}</strong></a>
        <a class="kpi" href="#/ordenes?f=working"><span>En proceso</span><strong>${working.length}</strong></a>
        <a class="kpi dark" href="#/ordenes?f=ready"><span>Listas para entregar</span><strong>${ready.length}</strong></a>
        <a class="kpi ${late.length ? 'warn' : ''}" href="#/ordenes?f=late"><span>Retrasadas</span><strong>${late.length}</strong></a>
      </div>
      <div class="dash">
        <section class="card">
          <h2>Prioridades</h2>
          ${returns.length ? `<p class="small" style="margin-top:-6px"><b>${returns.length} OT rechazada(s)</b> con piezas por devolver.</p>` : ''}
          <div class="list">${list.length ? list.slice(0, 30).map(orderRow).join('') : '<div class="empty"><b>No hay OT abiertas</b>Registra una recepción para empezar.</div>'}</div>
          ${list.length > 30 ? '<p style="margin-bottom:0"><a href="#/ordenes?f=open">Ver todas las abiertas</a></p>' : ''}
        </section>
        <section class="grid">
          <a class="money-card" href="#/cartera" style="text-decoration:none"><span>Saldo por cobrar</span><strong>${money(toCollect)}</strong>
            <small>${inCredit ? `Incluye ${money(inCredit)} en crédito` : `${receivable.length} OT con saldo`}</small></a>
          <div class="card"><h2>Entregas de la semana</h2>
            ${weekRows.length ? weekRows.map((k) => `<div class="money-line"><span style="text-transform:capitalize">${k === today ? 'Hoy' : esc(dayLabel(k))}</span><b>${week[k]} OT</b></div>`).join('')
              : '<p class="muted" style="margin:0">Sin entregas programadas en los próximos 7 días.</p>'}
          </div>
        </section>
      </div>`;
  };
  ctx.refresh = load;
  await load();
}
