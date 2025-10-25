-- Update default deployment limit to 0 for new users
ALTER TABLE public.deployment_limits ALTER COLUMN max_deployments SET DEFAULT 0;

-- Update the handle_new_user function to set default limit to 0
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  
  -- Assign default 'user' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Create default deployment limit (0 for new users)
  INSERT INTO public.deployment_limits (user_id, max_deployments)
  VALUES (NEW.id, 0);
  
  RETURN NEW;
END;
$$;