-- Fotos y capturas: bucket privado. Solo usuarios activos de la app pueden subir y ver.
-- Las imágenes se muestran con URLs firmadas de corta duración. Nadie puede sobrescribir ni borrar (solo el administrador).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ot-files', 'ot-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "ot_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'ot-files' and public.app_is_active());

create policy "ot_files_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ot-files' and public.app_is_active());

create policy "ot_files_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ot-files' and public.app_is_admin());
