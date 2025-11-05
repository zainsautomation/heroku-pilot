-- Add UPDATE policy for deployments table
-- This allows users to update their own deployment status
CREATE POLICY "Users can update own deployment status" 
ON public.deployments
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Also add policies for admins and moderators to update all deployments
CREATE POLICY "Admins can update all deployments" 
ON public.deployments
FOR UPDATE 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Moderators can update all deployments" 
ON public.deployments
FOR UPDATE 
USING (has_role(auth.uid(), 'moderator'::app_role))
WITH CHECK (has_role(auth.uid(), 'moderator'::app_role));