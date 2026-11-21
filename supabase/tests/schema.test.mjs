import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const ADMIN = '00000000-0000-0000-0000-00000000000a';
const TECH  = '00000000-0000-0000-0000-00000000000b';
let pass = 0, fail = 0;

// Simula Supabase: roles, auth.users y auth.uid()
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  grant usage on schema public to authenticated, anon;
  alter default privileges in schema public grant all on tables to authenticated, anon;
  alter default privileges in schema public grant all on sequences to authenticated, anon;
`);
await db.exec(readFileSync(new URL('../migrations/20261121000001_init.sql', import.meta.url), 'utf8'));
await db.exec(`
  insert into auth.users values ('${ADMIN}'), ('${TECH}');
  insert into profiles (id, full_name, role) values ('${ADMIN}', 'Dueño (prueba)', 'admin'), ('${TECH}', 'Técnico (prueba)', 'technician');
`);

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
async function ok(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '→', e.message); }
}
async function fails(name, fn, expect) {
  try { await fn(); fail++; console.log('  ✗', name, '→ debió fallar'); }
  catch (e) {
    if (expect && !e.message.includes(expect)) { fail++; console.log('  ✗', name, '→ error inesperado:', e.message); }
    else { pass++; console.log('  ✓', name, '→', e.message); }
  }
}
const one = async (uid, sql, p) => (await as(uid, sql, p))[0];
const view = (id) => one(ADMIN, 'select status, billable, paid, balance, financial_status, is_open, pending_return, is_overdue from v_work_orders where id=$1', [id]);
const parts = JSON.stringify([{ part_type: 'block', received: true, condition_notes: 'Ficticio' }, { part_type: 'crankshaft', received: true }, { part_type: 'cylinder_head', received: false }]);

// ---- Datos ficticios de prueba ----
const cust = (await one(TECH, `insert into customers (name, customer_type, id_type, id_number, phone) values ('Cliente Prueba 1','individual','CC','1000','3000000001') returning id`)).id;
const comp = (await one(TECH, `insert into customers (name, customer_type, id_type, id_number) values ('Empresa Prueba S.A.S.','company','NIT','900000001') returning id`)).id;
const mech = (await one(TECH, `insert into mechanics (name, phone) values ('Mecánico Prueba','3000000002') returning id`)).id;
const newWO = (c) => one(TECH, `select work_order_create($1,$2,'MarcaX','Ref-1',null,'abc123','diesel',$3::jsonb) as id`, [c, mech, parts]).then(r => r.id);

console.log('\n1. Recepción');
await fails('cliente duplicado (misma CC)', () => as(TECH, `insert into customers (name, id_type, id_number) values ('Otro','CC','1000')`), 'duplicate');
await fails('sin marca', () => as(TECH, `select work_order_create($1,$2,'','Ref',null,null,'diesel',$3::jsonb)`, [cust, mech, parts]), 'obligatorios');
await fails('sin piezas recibidas', () => as(TECH, `select work_order_create($1,$2,'M','R',null,null,'diesel','[{"part_type":"block","received":false}]'::jsonb)`, [cust, mech]), 'pieza');
const wo1 = await newWO(cust);
await ok('OT creada con número único y fecha automática', async () => {
  const r = await one(TECH, 'select number, status, received_at from work_orders where id=$1', [wo1]);
  if (r.number !== 1n && r.number != 1) throw new Error('número ' + r.number);
  if (r.status !== 'reception' || !r.received_at) throw new Error(JSON.stringify(r));
});
await fails('técnico no puede cambiar el estado directo', () => as(TECH, `update work_orders set status='ready' where id=$1`, [wo1]), 'permission');
await fails('técnico no puede darse crédito', () => as(TECH, `update customers set credit_authorized=true where id=$1`, [comp]), 'permission');
await fails('sin sesión no se lee nada', async () => { const r = await as(null, 'select * from work_orders'); if (!r.length) throw new Error('permission denied (0 filas)'); }, 'permission');

console.log('\n2. Diagnóstico y cotización');
await ok('diagnóstico guardado → Diagnóstico', async () => {
  await as(TECH, `select diagnosis_save($1, '{"block_notes":"ovalado"}'::jsonb, '[{"section":"block","point":"cilindro_1","value_mm":"82.012"},{"section":"crankshaft","point":"bancada_1","value_mm":"57.981"}]'::jsonb)`, [wo1]);
  if ((await view(wo1)).status !== 'diagnosis') throw new Error('estado');
});
await fails('"Otro trabajo" sin descripción', () => as(TECH, `select quote_save_draft($1, '[{"concept_code":"other","amount":100}]'::jsonb)`, [wo1]), 'Describe');
const q1 = (await one(TECH, `select quote_save_draft($1, '[{"concept_code":"block","amount":450000},{"concept_code":"crankshaft","amount":380000},{"concept_code":"washing","amount":90000}]'::jsonb) as id`, [wo1])).id;
await ok('técnico cotiza; total 920.000; vigencia 8 días', async () => {
  const r = await one(ADMIN, 'select total, valid_until - app_today() as d from quotes where id=$1', [q1]);
  if (r.total != 920000 || r.d !== 8) throw new Error(JSON.stringify(r));
});
await fails('no se aprueba sin enviar', () => as(ADMIN, `select quote_approve($1,'Mecánico','whatsapp')`, [q1]), 'enviada');
await as(ADMIN, 'select quote_send($1)', [q1]);
await ok('enviada → Esperando aprobación, sin valor a cobrar aún', async () => { const v = await view(wo1); if (v.status !== 'awaiting_approval' || v.billable !== null) throw new Error(JSON.stringify(v)); });
await fails('cotización enviada no se puede editar', () => as(ADMIN, `update quote_items set amount=1 where quote_id=$1`, [q1]), 'permission');
await fails('saltarse aprobación (→ Listo)', () => as(TECH, 'select work_order_send_to_qc($1)', [wo1]), 'no permitido');

console.log('\n3. Anticipo, aprobación, calidad');
await ok('anticipo antes de aprobar', () => as(ADMIN, `select payment_record($1, 300000, 'cash')`, [wo1]));
await fails('aprobar sin decir quién autorizó', () => as(ADMIN, `select quote_approve($1,'','whatsapp')`, [q1]), 'Indica');
await ok('técnico aprueba → En proceso; fecha = 2 días hábiles', async () => {
  await as(TECH, `select quote_approve($1,'Mecánico Prueba','whatsapp','Aprobó 10:32')`, [q1]);
  const r = await one(ADMIN, `select status, estimated_delivery_at = add_business_days(received_at, 0) as x, estimated_delivery_at > now() as fut from work_orders where id=$1`, [wo1]);
  if (r.status !== 'in_progress' || !r.fut) throw new Error(JSON.stringify(r));
});
await ok('saldo = 920.000 − 300.000', async () => { const v = await view(wo1); if (v.balance != 620000) throw new Error(v.balance); });
await as(TECH, 'select work_order_send_to_qc($1)', [wo1]);
await fails('calidad no aprobada sin explicar', () => as(TECH, `select quality_check_record($1,'failed')`, [wo1]), 'Describe');
await ok('calidad no aprobada → vuelve a proceso', async () => { await as(TECH, `select quality_check_record($1,'failed','Rayón en muñón 2')`, [wo1]); if ((await view(wo1)).status !== 'in_progress') throw new Error('estado'); });
await as(TECH, 'select work_order_send_to_qc($1)', [wo1]);
await as(TECH, `select quality_check_record($1,'passed')`, [wo1]);
await ok('calidad aprobada → Listo para entregar', async () => { if ((await view(wo1)).status !== 'ready') throw new Error('estado'); });

console.log('\n4. Entrega de contado');
await fails('pago mayor al saldo', () => as(ADMIN, `select payment_record($1, 700000, 'transfer')`, [wo1]), 'supera');
await fails('entregar con saldo sin crédito', () => as(ADMIN, `select work_order_deliver($1,'Mecánico Prueba')`, [wo1]), 'saldo');
await fails('particular no puede usar crédito', () => as(ADMIN, `select work_order_deliver($1,'Mecánico Prueba',null,true)`, [wo1]), 'crédito autorizado');
const pBad = (await one(TECH, `select payment_record($1, 20000, 'cash') as id`, [wo1])).id;
await fails('técnico no anula pagos', () => as(TECH, `select payment_void($1,'x')`, [pBad]), 'administrador');
await ok('anular pago con motivo (no se borra)', async () => { await as(ADMIN, `select payment_void($1,'Digitado por error')`, [pBad]); const v = await view(wo1); if (v.balance != 620000) throw new Error(v.balance); });
await as(ADMIN, `select payment_record($1, 620000, 'transfer', 'Ref banco 123')`, [wo1]);
await ok('entrega sin saldo → paz y salvo', async () => {
  const r = await one(ADMIN, `select work_order_deliver($1,'Mecánico Prueba','1000') as r`, [wo1]);
  const v = await view(wo1);
  if (r.r !== 'settled' || v.financial_status !== 'settled' || v.is_open) throw new Error(JSON.stringify({ r, v }));
});
await fails('OT entregada no se reabre', () => as(ADMIN, `select work_order_revert_status($1,'in_progress','prueba')`, [wo1]), 'cerrada');

console.log('\n5. Rechazo');
const wo2 = await newWO(cust);
await as(TECH, `select diagnosis_save($1)`, [wo2]);
const q2 = (await one(ADMIN, `select quote_save_draft($1, '[{"concept_code":"block","amount":500000},{"concept_code":"washing","amount":80000}]'::jsonb) as id`, [wo2])).id;
await fails('diagnóstico no va como línea en la cotización', () => as(ADMIN, `select quote_save_draft($1, '[{"concept_code":"diagnosis","amount":50000}]'::jsonb)`, [wo2]), 'no va como línea');
await as(ADMIN, 'select quote_send($1)', [q2]);
await fails('no se cobra rectificación en un rechazo', () => as(ADMIN, `select quote_reject($1,'Cliente','phone_call','[{"concept_code":"block","amount":500000}]'::jsonb)`, [q2]), 'no se cobra');
await ok('rechazo cobra lavado + diagnóstico elegido (130.000) y deja devolución pendiente', async () => {
  await as(ADMIN, `select quote_reject($1,'Cliente','phone_call','[{"concept_code":"washing","amount":80000},{"concept_code":"diagnosis","amount":50000}]'::jsonb)`, [q2]);
  const v = await view(wo2);
  if (v.status !== 'rejected' || v.billable != 130000 || !v.pending_return || v.is_open) throw new Error(JSON.stringify(v));
  const orig = await one(ADMIN, `select status, total from quotes where id=$1`, [q2]);
  if (orig.status !== 'rejected' || orig.total != 580000) throw new Error('cotización original alterada');
});
await ok('pago del lavado → paz y salvo; devolución registrada', async () => {
  await as(ADMIN, `select payment_record($1, 130000, 'cash')`, [wo2]);
  await as(TECH, `select work_order_return_parts($1,'Cliente')`, [wo2]);
  const v = await view(wo2);
  if (v.financial_status !== 'settled' || v.pending_return) throw new Error(JSON.stringify(v));
});

console.log('\n6. Crédito empresa');
const wo3 = await newWO(comp);
await as(TECH, `select diagnosis_save($1)`, [wo3]);
const q3 = (await one(ADMIN, `select quote_save_draft($1, '[{"concept_code":"cylinder_head","amount":300000}]'::jsonb) as id`, [wo3])).id;
await as(ADMIN, 'select quote_send($1)', [q3]);
await as(ADMIN, `select quote_approve($1,'Jefe taller','whatsapp')`, [q3]);
await ok('adicional en proceso: nueva versión, requiere aprobación', async () => {
  const q4 = (await one(ADMIN, `select quote_save_draft($1, '[{"concept_code":"cylinder_head","amount":300000},{"concept_code":"guides_valves","amount":150000}]'::jsonb) as id`, [wo3])).id;
  await as(ADMIN, 'select quote_send($1)', [q4]);
  if ((await view(wo3)).billable != 300000) throw new Error('cambió antes de aprobar');
  await as(ADMIN, `select quote_approve($1,'Jefe taller','whatsapp','Aprueba guías')`, [q4]);
  if ((await view(wo3)).billable != 450000) throw new Error('no tomó el adicional');
});
await as(TECH, 'select work_order_send_to_qc($1)', [wo3]);
await as(TECH, `select quality_check_record($1,'passed')`, [wo3]);
await fails('empresa sin factura no se entrega', () => as(TECH, `select work_order_deliver($1,'Conductor',null,true)`, [wo3]), 'factura');
await as(TECH, `select invoice_record($1,'FE-123')`, [wo3]);
await fails('empresa sin crédito autorizado', () => as(ADMIN, `select work_order_deliver($1,'Conductor',null,true)`, [wo3]), 'crédito autorizado');
await fails('técnico no autoriza crédito', () => as(TECH, `select customer_set_credit($1,true,30)`, [comp]), 'administrador');
await as(ADMIN, `select customer_set_credit($1,true,30,400000)`, [comp]);
await fails('supera cupo de crédito (450.000 > 400.000)', () => as(ADMIN, `select work_order_deliver($1,'Conductor',null,true)`, [wo3]), 'cupo');
await as(ADMIN, `select customer_set_credit($1,true,30,null)`, [comp]);
await ok('entregado con crédito pendiente, vence en 30 días', async () => {
  const r = await one(ADMIN, `select work_order_deliver($1,'Conductor',null,true) as r`, [wo3]);
  const v = await view(wo3);
  const d = await one(ADMIN, `select credit_due_on - current_date as d from work_orders where id=$1`, [wo3]);
  if (r.r !== 'credit_pending' || v.financial_status !== 'credit_current' || d.d !== 30) throw new Error(JSON.stringify({ r, v, d }));
});
await ok('al pagar el crédito → paz y salvo', async () => {
  await as(ADMIN, `select payment_record($1, 450000, 'transfer')`, [wo3]);
  if ((await view(wo3)).financial_status !== 'settled') throw new Error('estado financiero');
});
await ok('historial completo con usuario en cada evento', async () => {
  const r = await as(ADMIN, `select event_type, actor from work_order_events where work_order_id=$1 order by id`, [wo3]);
  if (r.some(e => !e.actor)) throw new Error('evento sin usuario');
  console.log('     ', r.map(e => e.event_type).join(' → '));
});

console.log('\n7. Calendario');
const expected2026 = ['2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29','2026-07-13','2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02','2026-11-16','2026-12-08','2026-12-25'];
await ok('19 festivos 2026 = lista oficial publicada', async () => {
  const r = await as(ADMIN, `select to_char(day,'YYYY-MM-DD') d from co_holidays(2026) order by day`);
  const got = r.map(x => x.d);
  if (JSON.stringify(got) !== JSON.stringify(expected2026)) throw new Error(got.join(','));
});
await ok('días hábiles: sábado sí, domingo y festivo no', async () => {
  const r = await one(ADMIN, `select is_business_day('2026-11-21') sab, is_business_day('2026-11-22') dom, is_business_day('2026-11-16') fest, is_business_day('2026-11-23') lun`);
  if (!r.sab || r.dom || r.fest || !r.lun) throw new Error(JSON.stringify(r));
});
await ok('2 días hábiles desde viernes 13-nov-2026 10:00 → martes 17 (salta domingo y festivo 16)', async () => {
  const r = await one(ADMIN, `select to_char(add_business_days('2026-11-13 10:00-05', 2) at time zone 'America/Bogota','YYYY-MM-DD HH24:MI') d`);
  if (r.d !== '2026-11-17 10:00') throw new Error(r.d);
});
await ok('1,5 días hábiles desde sábado 21-nov 08:00 → lunes 23 20:00', async () => {
  const r = await one(ADMIN, `select to_char(add_business_days('2026-11-21 08:00-05', 1.5) at time zone 'America/Bogota','YYYY-MM-DD HH24:MI') d`);
  if (r.d !== '2026-11-23 20:00') throw new Error(r.d);
});
await ok('código OT-0001', async () => { const r = await one(ADMIN, `select code from v_work_orders where id=$1`, [wo1]); if (r.code !== 'OT-0001') throw new Error(r.code); });

console.log(`\nResultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
