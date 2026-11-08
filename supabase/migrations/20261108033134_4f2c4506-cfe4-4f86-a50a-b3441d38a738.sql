DROP POLICY IF EXISTS "Block anonymous access to user_roles" ON public.user_roles;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_deployment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_deployment(uuid, uuid) TO service_role;

DELETE FROM public.system_settings WHERE setting_key = 'heroku_api_key';