// Acceso a datos. Toda escritura de OT pasa por funciones (RPC) de la base de datos.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const must = ({ data, error }) => { if (error) throw error; return data; };

export const rpc = async (fn, args) => must(await sb.rpc(fn, args));

export const db = {
  me: async (uid) => must(await sb.from('profiles').select('*').eq('id', uid).maybeSingle()),
  profiles: async () => must(await sb.from('profiles').select('id, full_name, email, role, active').order('full_name')),

  orders: async ({ statuses, search, from, to, limit = 300 } = {}) => {
    let q = sb.from('v_work_orders').select('*').order('received_at', { ascending: false }).limit(limit);
    if (statuses?.length) q = q.in('status', statuses);
    if (from) q = q.gte('received_at', from);
    if (to) q = q.lte('received_at', to);
    if (search) {
      const s = search.replace(/[%,()]/g, ' ').trim();
      const n = Number(s.replace(/^OT-?/i, ''));
      const ors = [`customer_name.ilike.%${s}%`, `id_number.ilike.%${s}%`, `customer_phone.ilike.%${s}%`,
        `brand.ilike.%${s}%`, `reference.ilike.%${s}%`, `mechanic_name.ilike.%${s}%`, `plate.ilike.%${s}%`];
      if (Number.isInteger(n) && n > 0) ors.push(`number.eq.${n}`);
      q = q.or(ors.join(','));
    }
    return must(await q);
  },
  order: async (id) => must(await sb.from('v_work_orders').select('*').eq('id', id).single()),

  orderDetail: async (id) => {
    const [parts, atts, diag, meas, quotes, approvals, qcs, pays, invs, hand, events, wo] = await Promise.all([
      sb.from('received_parts').select('*, part_types(name, sort)').eq('work_order_id', id),
      sb.from('attachments').select('*').eq('work_order_id', id).order('created_at'),
      sb.from('diagnoses').select('*').eq('work_order_id', id).maybeSingle(),
      sb.from('diagnostic_measurements').select('*').eq('work_order_id', id),
      sb.from('quotes').select('*, quote_items(*)').eq('work_order_id', id).order('version'),
      sb.from('customer_approvals').select('*').eq('work_order_id', id).order('recorded_at'),
      sb.from('quality_checks').select('*').eq('work_order_id', id).order('checked_at'),
      sb.from('payments').select('*').eq('work_order_id', id).order('received_at'),
      sb.from('invoices').select('*').eq('work_order_id', id).order('created_at'),
      sb.from('handovers').select('*').eq('work_order_id', id).maybeSingle(),
      sb.from('work_order_events').select('*').eq('work_order_id', id).order('id', { ascending: false }),
      sb.from('work_orders').select('general_notes, engine_id, customer_id').eq('id', id).single(),
    ]);
    for (const r of [parts, atts, diag, meas, quotes, approvals, qcs, pays, invs, hand, events, wo]) if (r.error) throw r.error;
    return {
      parts: parts.data.sort((a, b) => (a.part_types?.sort ?? 0) - (b.part_types?.sort ?? 0)),
      attachments: atts.data, diagnosis: diag.data, measurements: meas.data,
      quotes: quotes.data.map((q) => ({ ...q, quote_items: (q.quote_items || []).sort((a, b) => a.sort - b.sort) })),
      approvals: approvals.data, qcs: qcs.data, payments: pays.data, invoices: invs.data,
      handover: hand.data, events: events.data, wo: wo.data,
    };
  },

  customers: async (search) => {
    let q = sb.from('customers').select('*').order('name').limit(50);
    if (search) {
      const s = search.replace(/[%,()]/g, ' ').trim();
      q = q.or(`name.ilike.%${s}%,id_number.ilike.%${s}%,phone.ilike.%${s}%`);
    }
    return must(await q);
  },
  customer: async (id) => must(await sb.from('customers').select('*').eq('id', id).single()),
  createCustomer: async (c) => must(await sb.from('customers').insert(c).select().single()),
  updateCustomer: async (id, c) => must(await sb.from('customers').update(c).eq('id', id).select().single()),

  mechanics: async () => must(await sb.from('mechanics').select('*').order('name')),
  createMechanic: async (m) => must(await sb.from('mechanics').insert(m).select().single()),

  partTypes: async () => must(await sb.from('part_types').select('*').eq('active', true).order('sort')),
  concepts: async () => must(await sb.from('service_concepts').select('*').eq('active', true).order('sort')),
  engine: async (id) => must(await sb.from('engines').select('*').eq('id', id).single()),
};

// Fotos: se suben al bucket privado y se registra la ruta en "attachments".
export async function uploadAttachment({ workOrderId, kind, blob, receivedPartId = null, uid }) {
  const path = `${workOrderId}/${kind}/${crypto.randomUUID()}.jpg`;
  must(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
  return must(await sb.from('attachments').insert({
    work_order_id: workOrderId, received_part_id: receivedPartId, kind,
    storage_path: path, mime_type: 'image/jpeg', size_bytes: blob.size, uploaded_by: uid,
  }).select().single());
}

export async function signedUrls(paths) {
  if (!paths.length) return {};
  const data = must(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600));
  return Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

// Administración de usuarios (función del servidor con permisos de administrador)
export async function adminUsers(action, payload = {}) {
  const { data, error } = await sb.functions.invoke('admin-users', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  return data;
}
