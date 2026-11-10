ALTER TABLE public.deployments DROP CONSTRAINT IF EXISTS deployments_app_template_id_fkey;
ALTER TABLE public.deployments
  ADD CONSTRAINT deployments_app_template_id_fkey
  FOREIGN KEY (app_template_id)
  REFERENCES public.app_templates(id)
  ON DELETE RESTRICT;