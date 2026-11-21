// Genera la cotización como imagen (PNG) para enviarla por WhatsApp.
import { COMPANY } from './config.js';
import { money, date } from './ui.js';

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function quoteImage(o, quote, conceptNames) {
  const W = 1080, P = 64;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const items = quote.quote_items;
  c.width = W;
  c.height = 760 + items.length * 64 + (quote.notes_for_customer ? 160 : 0);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, c.height);
  ctx.fillStyle = '#b4231f'; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px system-ui, Arial'; ctx.fillText(COMPANY.name, P, 88);
  ctx.font = '28px system-ui, Arial'; ctx.fillText(COMPANY.phone, P, 128);
  ctx.textAlign = 'right'; ctx.font = 'bold 34px system-ui, Arial'; ctx.fillText('Cotización', W - P, 88);
  ctx.font = '28px system-ui, Arial'; ctx.fillText(`${o.code} · v${quote.version}`, W - P, 128);
  ctx.textAlign = 'left';

  let y = 220;
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 34px system-ui, Arial'; ctx.fillText(o.customer_name, P, y);
  y += 46; ctx.fillStyle = '#475569'; ctx.font = '28px system-ui, Arial';
  ctx.fillText(`Motor: ${o.brand} ${o.reference}${o.plate ? ' · Placa ' + o.plate : ''}`, P, y);
  y += 40; ctx.fillText(`Fecha: ${date(quote.sent_at || quote.created_at)}`, P, y);
  y += 50; ctx.fillStyle = '#e2e8f0'; ctx.fillRect(P, y, W - 2 * P, 3);
  y += 56;
  for (const i of items) {
    ctx.fillStyle = '#0f172a'; ctx.font = '30px system-ui, Arial';
    const name = i.description || conceptNames[i.concept_code] || i.concept_code;
    ctx.fillText(wrap(ctx, name, 640)[0], P, y);
    ctx.textAlign = 'right'; ctx.font = 'bold 30px system-ui, Arial'; ctx.fillText(money(i.amount), W - P, y); ctx.textAlign = 'left';
    y += 64;
  }
  ctx.fillStyle = '#e2e8f0'; ctx.fillRect(P, y - 30, W - 2 * P, 3);
  y += 40;
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 40px system-ui, Arial'; ctx.fillText('Total', P, y);
  ctx.textAlign = 'right'; ctx.fillStyle = '#b4231f'; ctx.font = 'bold 48px system-ui, Arial'; ctx.fillText(money(quote.total), W - P, y); ctx.textAlign = 'left';
  y += 44; ctx.fillStyle = '#64748b'; ctx.font = '26px system-ui, Arial'; ctx.fillText('IVA incluido · Mano de obra incluida', P, y);
  if (quote.valid_until) { y += 40; ctx.fillText(`Válida hasta el ${date(quote.valid_until + 'T12:00:00')}`, P, y); }
  if (quote.notes_for_customer) {
    y += 60; ctx.fillStyle = '#334155'; ctx.font = '28px system-ui, Arial';
    for (const l of wrap(ctx, quote.notes_for_customer, W - 2 * P).slice(0, 4)) { ctx.fillText(l, P, y); y += 38; }
  }
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// Comparte la imagen (Android abre WhatsApp) o la descarga si el equipo no permite compartir
export async function shareQuoteImage(o, quote, conceptNames) {
  const blob = await quoteImage(o, quote, conceptNames);
  const file = new File([blob], `${o.code}-cotizacion-v${quote.version}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Cotización ${o.code}` }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
