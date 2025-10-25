-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Create profiles table for user information
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table (separate for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Create app_templates table
CREATE TABLE public.app_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  github_repo_url TEXT NOT NULL,
  heroku_deploy_url TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create deployments table
CREATE TABLE public.deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_template_id UUID NOT NULL REFERENCES public.app_templates(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  heroku_app_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create deployment_limits table
CREATE TABLE public.deployment_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  max_deployments INTEGER NOT NULL DEFAULT 5,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create system_settings table
CREATE TABLE public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default system message
INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('limit_reached_message', 'Contact admin to increase your deployment limit.');

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to get user's primary role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE 
    WHEN role = 'admin' THEN 1
    WHEN role = 'moderator' THEN 2
    ELSE 3
  END
  LIMIT 1
$$;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'moderator'));

-- User roles policies
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'moderator'));

CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- App templates policies
CREATE POLICY "Everyone can view templates"
  ON public.app_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert templates"
  ON public.app_templates FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can insert templates"
  ON public.app_templates FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'moderator'));

CREATE POLICY "Admins can update templates"
  ON public.app_templates FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can update templates"
  ON public.app_templates FOR UPDATE
  USING (public.has_role(auth.uid(), 'moderator'));

CREATE POLICY "Admins can delete templates"
  ON public.app_templates FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can delete templates"
  ON public.app_templates FOR DELETE
  USING (public.has_role(auth.uid(), 'moderator'));

-- Deployments policies
CREATE POLICY "Users can view own deployments"
  ON public.deployments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all deployments"
  ON public.deployments FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can view all deployments"
  ON public.deployments FOR SELECT
  USING (public.has_role(auth.uid(), 'moderator'));

CREATE POLICY "Users can insert deployments"
  ON public.deployments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Deployment limits policies
CREATE POLICY "Users can view own limits"
  ON public.deployment_limits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all limits"
  ON public.deployment_limits FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can view all limits"
  ON public.deployment_limits FOR SELECT
  USING (public.has_role(auth.uid(), 'moderator'));

CREATE POLICY "Admins can insert limits"
  ON public.deployment_limits FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update limits"
  ON public.deployment_limits FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can update limits"
  ON public.deployment_limits FOR UPDATE
  USING (public.has_role(auth.uid(), 'moderator'));

-- System settings policies
CREATE POLICY "Everyone can view settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can update settings"
  ON public.system_settings FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  
  -- Create default deployment limit
  INSERT INTO public.deployment_limits (user_id, max_deployments)
  VALUES (NEW.id, 5);
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_app_templates_updated_at
  BEFORE UPDATE ON public.app_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();