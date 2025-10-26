-- Fix RLS policy for system_settings to allow admins to insert
CREATE POLICY "Admins can insert settings"
ON public.system_settings
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow admins and moderators to insert deployments
CREATE POLICY "Admins can insert deployments"
ON public.deployments
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Moderators can insert deployments"
ON public.deployments
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'moderator'::app_role));

-- Allow users to delete their own deployments
CREATE POLICY "Users can delete own deployments"
ON public.deployments
FOR DELETE
USING (auth.uid() = user_id);

-- Allow admins to delete any deployment
CREATE POLICY "Admins can delete deployments"
ON public.deployments
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));