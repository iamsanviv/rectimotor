-- Recomendaciones del asesor de seguridad de Supabase: search_path fijo en todas las funciones.
alter function public.app_uid() set search_path = public;
alter function public.app_today() set search_path = public;
alter function public.easter_sunday(int) set search_path = public;
alter function public.next_monday(date) set search_path = public;
alter function public.co_holidays(int) set search_path = public;
alter function public.is_business_day(date) set search_path = public;
alter function public.add_business_days(timestamptz, numeric) set search_path = public;
alter function public.trg_quote_items_guard() set search_path = public;
alter function public.trg_quote_items_total() set search_path = public;
alter function public.trg_touch_updated_at() set search_path = public;
alter function public._allowed(wo_status, wo_status) set search_path = public;

-- Las funciones auxiliares no necesitan estar expuestas en la API.
revoke execute on function public.app_require(boolean) from authenticated;
