-- Add config_vars column to app_templates to store predefined environment variable names
ALTER TABLE app_templates 
ADD COLUMN config_vars jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN app_templates.config_vars IS 'Predefined environment variable names that users need to configure during deployment';