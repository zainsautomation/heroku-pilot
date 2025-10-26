-- Add heroku_app_name column to deployments table
ALTER TABLE public.deployments 
ADD COLUMN IF NOT EXISTS heroku_app_name text;