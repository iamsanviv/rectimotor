import { db } from '../db.js';
import { esc, money, shortDate, badge, OPEN } from '../ui.js';
import { orderRow } from './orders.js';

export async function render(el, ctx) {
  const load = async () => {
    const all = await db.orders({ limit: 500 });
    const open = all.filter((o) => OPEN.includes(o.status));
    const late = open.filter((o) => o.is_overdue);
    const ready = open.filter((o) => o.status === 'ready');
    const quoting = open.filter((o) => ['reception', 'diagnosis', 'awaiting_approval'].includes(o.status));
    const working = open.filter((o) => ['in_progress', 'quality_control'].includes(o.status));
    const receivable = all.filter((o) => ['pending', 'credit_current', 'credit_overdue'].includes(o.financial_status));
    const toCollect = receivable.reduce((s, o) => s + Number(o.balance || 0), 0);
    const returns = all.filter((o) => o.pending_return);

    const prio = (o) => (o.is_overdue ? 0 : o.status === 'ready' ? 1 : 2);
    const list = [...open, ...returns].sort((a, b) => prio(a) - prio(b)
      || new Date(a.estimated_delivery_at || '2999-01-01') - new Date(b.estimated_delivery_at || '2999-01-01'));

    el.innerHTML = `
      <div class="page-head"><div><h1>Tablero</h1><p class="muted">Hola, ${esc(ctx.me.full_name.split(' ')[0])}. Así va el taller hoy.</p></div>
        <a class="btn primary" href="#/nueva">＋ Nueva OT</a></div>
      <div class="kpis">
        <a class="kpi" href="#/ordenes?f=open"><span>OT abiertas</span><strong>${open.length}</strong></a>
        <a class="kpi" href="#/ordenes?f=quoting"><span>Por cotizar o aprobar</span><strong>${quoting.length}</strong></a>
        <a class="kpi" href="#/ordenes?f=working"><span>En proceso y calidad</span><strong>${working.length}</strong></a>
        <a class="kpi good" href="#/ordenes?f=ready"><span>Listas para entregar</span><strong>${ready.length}</strong></a>
        <a class="kpi ${late.length ? 'warn' : ''}" href="#/ordenes?f=late"><span>Retrasadas</span><strong>${late.length}</strong></a>
        <a class="kpi ${toCollect ? 'warn' : ''}" href="#/cartera"><span>Saldo por cobrar</span><strong style="font-size:22px">${money(toCollect)}</strong></a>
      </div>
      ${returns.length ? `<div class="card" style="margin-bottom:14px;border-color:#f3c4c4"><b>${returns.length} OT rechazada(s) con piezas por devolver.</b></div>` : ''}
      <h2>Prioridades</h2>
      <div class="list">${list.length ? list.map(orderRow).join('') : '<div class="card empty"><b>No hay OT abiertas</b>Registra una recepción para empezar.</div>'}</div>`;
  };
  ctx.refresh = load;
  await load();
}
