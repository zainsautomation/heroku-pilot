-- Allow all authenticated users to read the limit_reached_message setting
CREATE POLICY "Users can view limit message"
ON public.system_settings
FOR SELECT
TO authenticated
USING (setting_key = 'limit_reached_message');