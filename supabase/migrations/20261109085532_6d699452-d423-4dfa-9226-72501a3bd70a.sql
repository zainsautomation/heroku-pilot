DROP POLICY IF EXISTS "Users can update own deployment status" ON public.deployments;
DROP POLICY IF EXISTS "Admins can update all deployments" ON public.deployments;
DROP POLICY IF EXISTS "Moderators can update all deployments" ON public.deployments;