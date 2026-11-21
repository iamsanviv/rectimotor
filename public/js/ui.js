// Utilidades de interfaz: formato, etiquetas, modales, avisos.
export const STATUS = {
  reception: 'Recepción',
  diagnosis: 'Diagnóstico',
  awaiting_approval: 'Esperando aprobación',
  in_progress: 'En proceso',
  quality_control: 'Control de calidad',
  ready: 'Listo para entregar',
  delivered: 'Entregado',
  rejected: 'Rechazado',
};
export const FLOW = ['reception', 'diagnosis', 'awaiting_approval', 'in_progress', 'quality_control', 'ready', 'delivered'];
export const OPEN = ['reception', 'diagnosis', 'awaiting_approval', 'in_progress', 'quality_control', 'ready'];

export const FINANCIAL = {
  no_amount: 'Sin valor aprobado',
  pending: 'Saldo pendiente',
  settled: 'Paz y salvo',
  credit_current: 'Crédito al día',
  credit_overdue: 'Crédito vencido',
  credit_balance: 'Saldo a favor del cliente',
};
export const FUEL = { diesel: 'Diésel', gasoline: 'Gasolina', gas: 'Gas', other: 'Otro', unspecified: 'Sin especificar' };
export const ID_TYPES = { CC: 'Cédula (CC)', NIT: 'NIT', CE: 'Cédula de extranjería', PP: 'Pasaporte', other: 'Otro' };
export const CHANNEL = { whatsapp: 'WhatsApp', in_person: 'En persona', phone_call: 'Llamada', other: 'Otro' };
export const METHOD = { cash: 'Efectivo', transfer: 'Transferencia' };
export const SECTION = {
  block: 'Bloque', crankshaft: 'Cigüeñal', cylinder_head: 'Culata', guides_valves: 'Guías y válvulas',
  connecting_rods: 'Bielas', camshaft: 'Árbol de levas', flywheel: 'Volante', pistons: 'Pistones', other: 'Otras medidas',
};
export const EVENT = {
  created: 'OT creada', status_change: 'Cambio de estado', diagnosis_updated: 'Diagnóstico actualizado',
  reception_updated: 'Recepción corregida', quote_sent: 'Cotización enviada', quote_withdrawn: 'Cotización retirada',
  additional_approved: 'Adicional aprobado', payment: 'Pago registrado', payment_voided: 'Pago anulado',
  settled: 'Quedó a paz y salvo', invoice: 'Factura registrada', parts_returned: 'Piezas devueltas',
  estimate_changed: 'Fecha de entrega cambiada', status_reverted: 'Corrección de estado',
};

const TZ = 'America/Bogota';
export const money = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v) || 0);
export const date = (d) => d ? new Date(d).toLocaleDateString('es-CO', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const dateTime = (d) => d ? new Date(d).toLocaleString('es-CO', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const shortDate = (d) => d ? new Date(d).toLocaleString('es-CO', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Sin definir';
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const badge = (status) => `<span class="badge st-${status}">${esc(STATUS[status] || status)}</span>`;
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2600);
}

// Mensaje de error entendible a partir de errores de Supabase/Postgres
export function errMsg(e) {
  const m = e?.message || String(e);
  if (/permission denied|not authorized|42501/i.test(m)) return 'No tienes permiso para hacer esto.';
  if (/duplicate key.*customers_doc_uq/i.test(m)) return 'Ya existe un cliente con ese documento.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión. Revisa el internet e intenta de nuevo.';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

// Ejecuta una acción con el botón bloqueado y avisa del resultado
export async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    console.error(e);
    toast(errMsg(e), true);
    throw e;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Modal simple. Devuelve el elemento; close() lo cierra.
export function modal({ title, body, actions = '', wide = false }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'width:min(900px,100%)' : ''}">
    <header><h2>${esc(title)}</h2><button class="btn ghost" data-close aria-label="Cerrar">✕</button></header>
    <div class="body">${body}</div>
    ${actions ? `<footer>${actions}</footer>` : ''}
  </div>`;
  root.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  wrap.close = close;
  setTimeout(() => wrap.querySelector('input,select,textarea')?.focus(), 50);
  return wrap;
}

export function viewImage(src) {
  modal({ title: 'Foto', body: `<div class="viewer"><img src="${esc(src)}" alt="Foto"></div>`, wide: true });
}

// Comprime una foto a JPEG (máx. 1600 px) antes de subirla
export function compressImage(file, maxSide = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la foto'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Archivo de imagen no válido')); };
    img.src = url;
  });
}

// Campo de foto reutilizable: cámara o archivo, con vista previa. Devuelve getFiles().
export function photoInput(container, { multiple = false, label = 'Tomar foto', onChange = null } = {}) {
  const files = [];
  container.innerHTML = `<div class="photo-pick">
      <label class="btn"><span>📷 ${esc(label)}</span>
        <input type="file" accept="image/*" capture="environment" ${multiple ? 'multiple' : ''} hidden></label>
    </div><div class="thumbs"></div>`;
  const input = container.querySelector('input');
  const thumbs = container.querySelector('.thumbs');
  input.addEventListener('change', async () => {
    for (const f of input.files) {
      try {
        const blob = await compressImage(f);
        if (!multiple) files.length = 0;
        files.push(blob);
      } catch (e) { toast(errMsg(e), true); }
    }
    input.value = '';
    thumbs.innerHTML = files.map((b, i) => `<img src="${URL.createObjectURL(b)}" alt="Foto ${i + 1}">`).join('');
    if (onChange && files.length) onChange(files.slice());
  });
  return { getFiles: () => files.slice() };
}

export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const digits = (s) => String(s || '').replace(/\D/g, '');
export const parseMoney = (s) => Number(digits(s)) || 0;
