-- Add build_log_url column to deployments table
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS build_log_url TEXT;