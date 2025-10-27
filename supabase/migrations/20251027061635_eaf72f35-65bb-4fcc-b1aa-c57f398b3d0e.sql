-- Add columns to app_templates for config variable metadata
ALTER TABLE app_templates
ADD COLUMN IF NOT EXISTS config_vars_metadata JSONB DEFAULT '[]'::jsonb;

-- Add heroku_app_name column to app_templates for custom app naming
ALTER TABLE app_templates
ADD COLUMN IF NOT EXISTS default_app_name TEXT;

COMMENT ON COLUMN app_templates.config_vars_metadata IS 'Array of objects containing {name, description, defaultValue, required}';
COMMENT ON COLUMN app_templates.default_app_name IS 'Default Heroku app name prefix';