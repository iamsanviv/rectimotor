import { db } from '../db.js';
import { esc, money, date, badge, FINANCIAL } from '../ui.js';
import { messages, openWhatsApp } from '../whatsapp.js';

export async function render(el, ctx) {
  const load = async () => {
    const all = await db.orders({ limit: 1000 });
    const due = all.filter((o) => ['pending', 'credit_current', 'credit_overdue'].includes(o.financial_status) && o.balance > 0)
      .sort((a, b) => (b.financial_status === 'credit_overdue') - (a.financial_status === 'credit_overdue') || b.balance - a.balance);
    const favor = all.filter((o) => o.financial_status === 'credit_balance');
    const sum = (rows) => rows.reduce((s, o) => s + Number(o.balance || 0), 0);
    const overdue = due.filter((o) => o.financial_status === 'credit_overdue');
    const credit = due.filter((o) => o.financial_status === 'credit_current');

    const table = (rows) => `<div class="card" style="overflow-x:auto"><table class="simple"><thead><tr>
        <th>OT</th><th>Cliente</th><th>Estado</th><th>Valor</th><th>Pagado</th><th>Saldo</th><th>Condición</th><th></th></tr></thead><tbody>
      ${rows.map((o) => `<tr><td><a href="#/ot/${o.id}"><b>${esc(o.code)}</b></a></td><td>${esc(o.customer_name)}</td><td>${badge(o.status)}</td>
        <td>${money(o.billable)}</td><td>${money(o.paid)}</td><td><b class="fin-${o.financial_status}">${money(o.balance)}</b></td>
        <td>${esc(FINANCIAL[o.financial_status])}${o.credit_due_on ? `<div class="small muted">vence ${date(o.credit_due_on + 'T12:00:00')}</div>` : ''}</td>
        <td><button class="btn ghost" data-wa="${o.id}" title="Recordar por WhatsApp">💬</button></td></tr>`).join('')}
      </tbody></table></div>`;

    el.innerHTML = `
      <div class="page-head"><div><h1>Cartera</h1><p class="muted">Saldos por cobrar, créditos y vencimientos.</p></div></div>
      <div class="kpis">
        <div class="kpi ${sum(due) ? 'warn' : ''}"><span>Total por cobrar</span><strong>${money(sum(due))}</strong></div>
        <div class="kpi"><span>En crédito al día</span><strong>${money(sum(credit))}</strong></div>
        <div class="kpi ${overdue.length ? 'warn' : ''}"><span>Crédito vencido</span><strong>${money(sum(overdue))}</strong></div>
        <div class="kpi"><span>OT con saldo</span><strong>${due.length}</strong></div>
      </div>
      ${due.length ? table(due) : '<div class="card empty"><b>Sin saldos pendientes</b>Todo está a paz y salvo.</div>'}
      ${favor.length ? `<h2 style="margin-top:18px">Saldos a favor del cliente</h2><p class="muted small">El anticipo superó el valor aprobado. Hay que devolver o aplicar la diferencia.</p>${table(favor)}` : ''}`;
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => {
      const o = all.find((x) => x.id === b.dataset.wa);
      openWhatsApp(o.customer_phone, messages.balance(o));
    });
  };
  ctx.refresh = load;
  await load();
}
