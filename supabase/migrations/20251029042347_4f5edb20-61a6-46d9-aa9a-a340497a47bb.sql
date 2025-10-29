-- Fix RLS policies to prevent unauthorized access

-- 1. Block anonymous access to profiles table (contains emails)
CREATE POLICY "Block anonymous access to profiles"
ON profiles FOR SELECT
USING (auth.role() = 'authenticated');

-- 2. Block anonymous access to deployments table
CREATE POLICY "Block anonymous access to deployments"
ON deployments FOR SELECT
USING (auth.role() = 'authenticated');

-- 3. Block anonymous access to deployment_limits table
CREATE POLICY "Block anonymous access to deployment limits"
ON deployment_limits FOR SELECT
USING (auth.role() = 'authenticated');

-- 4. Restrict system_settings to admin-only access (protects Heroku API key)
DROP POLICY IF EXISTS "Everyone can view settings" ON system_settings;

CREATE POLICY "Only admins can view settings"
ON system_settings FOR SELECT
USING (has_role(auth.uid(), 'admin'));

-- 5. Block anonymous access to user_roles table
CREATE POLICY "Block anonymous access to user_roles"
ON user_roles FOR SELECT
USING (auth.role() = 'authenticated');