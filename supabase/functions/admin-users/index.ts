// Administración de usuarios. Solo el administrador activo puede usarla,
// excepto "status" y "bootstrap", que sirven para crear el primer administrador cuando aún no hay usuarios.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function profileCount() {
  const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

async function createUser(email: string, password: string, full_name: string, role: 'admin' | 'technician') {
  if (!email || !full_name || !password || password.length < 8) throw new Error('Datos incompletos o contraseña corta (mínimo 8)');
  const { data, error } = await admin.auth.admin.createUser({ email: email.trim().toLowerCase(), password, email_confirm: true, app_metadata: { role } });
  if (error) throw new Error(error.message.includes('already') ? 'Ya existe un usuario con ese correo' : error.message);
  const { error: e2 } = await admin.from('profiles').insert({ id: data.user.id, full_name: full_name.trim(), email: data.user.email, role, active: true });
  if (e2) { await admin.auth.admin.deleteUser(data.user.id); throw e2; }
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'status') return json({ needs_bootstrap: (await profileCount()) === 0 });
    if (action === 'bootstrap') {
      if ((await profileCount()) > 0) return json({ error: 'Ya existe un administrador' }, 403);
      const id = await createUser(body.email, body.password, body.full_name, 'admin');
      return json({ id });
    }

    // Resto de acciones: requiere un administrador con sesión
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'Inicia sesión' }, 401);
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', u.user.id).maybeSingle();
    if (!me || !me.active || me.role !== 'admin') return json({ error: 'Solo el administrador puede hacer esto' }, 403);

    if (action === 'list') {
      const { data, error } = await admin.from('profiles').select('id, full_name, email, role, active').order('full_name');
      if (error) throw error;
      return json({ users: data });
    }
    if (action === 'create') {
      const role = body.role === 'admin' ? 'admin' : 'technician';
      return json({ id: await createUser(body.email, body.password, body.full_name, role) });
    }
    if (action === 'update') {
      if (!body.id) return json({ error: 'Falta el usuario' }, 400);
      if (body.id === u.user.id) return json({ error: 'No puedes cambiar tu propio rol o estado' }, 400);
      const patch: Record<string, unknown> = {};
      if (typeof body.full_name === 'string' && body.full_name.trim()) patch.full_name = body.full_name.trim();
      if (body.role === 'admin' || body.role === 'technician') patch.role = body.role;
      if (typeof body.active === 'boolean') patch.active = body.active;
      const { error } = await admin.from('profiles').update(patch).eq('id', body.id);
      if (error) throw error;
      const authPatch: Record<string, unknown> = {};
      if (body.password) {
        if (String(body.password).length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
        authPatch.password = body.password;
      }
      if (patch.role) authPatch.app_metadata = { role: patch.role };
      if (patch.active === false) authPatch.ban_duration = '876000h';
      if (patch.active === true) authPatch.ban_duration = 'none';
      if (Object.keys(authPatch).length) {
        const { error: e2 } = await admin.auth.admin.updateUserById(body.id, authPatch);
        if (e2) throw e2;
      }
      return json({ ok: true });
    }
    return json({ error: 'Acción no válida' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
