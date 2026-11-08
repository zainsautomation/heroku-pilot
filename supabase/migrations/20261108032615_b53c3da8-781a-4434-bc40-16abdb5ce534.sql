DROP POLICY IF EXISTS "Block anonymous access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Block anonymous access to deployments" ON public.deployments;
DROP POLICY IF EXISTS "Block anonymous access to deployment limits" ON public.deployment_limits;
DROP POLICY IF EXISTS "Block anonymous access to user_roles" ON public.user_roles;

DROP POLICY IF EXISTS "Users can insert deployments" ON public.deployments;
DROP POLICY IF EXISTS "Admins can insert deployments" ON public.deployments;
DROP POLICY IF EXISTS "Moderators can insert deployments" ON public.deployments;
DROP POLICY IF EXISTS "Users can delete own deployments" ON public.deployments;
DROP POLICY IF EXISTS "Admins can delete deployments" ON public.deployments;
DROP POLICY IF EXISTS "Users can update own deployment status" ON public.deployments;
DROP POLICY IF EXISTS "Admins can update all deployments" ON public.deployments;
DROP POLICY IF EXISTS "Moderators can update all deployments" ON public.deployments;

DROP POLICY IF EXISTS "Only admins can view settings" ON public.system_settings;
DROP POLICY IF EXISTS "Users can view limit message" ON public.system_settings;
DROP POLICY IF EXISTS "Everyone can view settings" ON public.system_settings;

CREATE POLICY "Admins can view non-secret settings"
ON public.system_settings
FOR SELECT
TO authenticated
USING (
  setting_key <> 'heroku_api_key'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Authenticated users can view limit message"
ON public.system_settings
FOR SELECT
TO authenticated
USING (setting_key = 'limit_reached_message');