// Mensajes de WhatsApp. Se abren con el texto listo; el empleado lo revisa y lo envía.
// PENDIENTE: reemplazar estos textos por los que defina Rectingeniería.
import { COMPANY } from './config.js';
import { money, date, shortDate } from './ui.js';

export function waPhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (p.length === 10 && p.startsWith('3')) p = '57' + p;
  return p;
}

export function openWhatsApp(phone, text) {
  const p = waPhone(phone);
  const url = p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

const motor = (o) => `${o.brand} ${o.reference}`;

export const messages = {
  quote(o, quote, conceptNames) {
    const lines = quote.quote_items.map((i) => `• ${i.description || conceptNames[i.concept_code] || i.concept_code}: ${money(i.amount)}`);
    return [
      `Hola, ${o.customer_name}. Te saluda ${COMPANY.name}.`,
      `Cotización de la orden ${o.code} (motor ${motor(o)}):`,
      ...lines,
      `*Total: ${money(quote.total)}* (IVA incluido)`,
      quote.valid_until ? `Válida hasta el ${date(quote.valid_until + 'T12:00:00')}.` : '',
      quote.notes_for_customer || '',
      '¿Nos confirmas si autorizas el trabajo?',
    ].filter(Boolean).join('\n');
  },
  approved(o) {
    return `Hola, ${o.customer_name}. Registramos la aprobación de la orden ${o.code} (motor ${motor(o)}). ` +
      `Fecha estimada de entrega: ${shortDate(o.estimated_delivery_at)}. ${COMPANY.name}.`;
  },
  ready(o) {
    const saldo = Number(o.balance) > 0 ? ` Saldo pendiente: ${money(o.balance)}.` : '';
    return `Hola, ${o.customer_name}. El trabajo de la orden ${o.code} (motor ${motor(o)}) está listo para recoger.${saldo} ${COMPANY.name}.`;
  },
  balance(o) {
    return `Hola, ${o.customer_name}. Te recordamos que la orden ${o.code} tiene un saldo pendiente de ${money(o.balance)}` +
      `${o.credit_due_on ? `, con vencimiento el ${date(o.credit_due_on + 'T12:00:00')}` : ''}. ${COMPANY.name}.`;
  },
};
