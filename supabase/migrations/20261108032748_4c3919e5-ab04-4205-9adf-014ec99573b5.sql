CREATE OR REPLACE FUNCTION public.reserve_deployment(_user_id uuid, _template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_limit integer;
  active_count integer;
  reserved_id uuid;
BEGIN
  SELECT max_deployments
    INTO current_limit
    FROM public.deployment_limits
    WHERE user_id = _user_id
    FOR UPDATE;

  IF current_limit IS NULL THEN
    RAISE EXCEPTION 'Deployment limit is not configured';
  END IF;

  SELECT count(*)::integer
    INTO active_count
    FROM public.deployments
    WHERE user_id = _user_id
      AND status IN ('success', 'pending');

  IF active_count >= current_limit THEN
    RAISE EXCEPTION 'Deployment limit reached';
  END IF;

  INSERT INTO public.deployments (user_id, app_template_id, status)
    VALUES (_user_id, _template_id, 'pending')
    RETURNING id INTO reserved_id;

  RETURN reserved_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_deployment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_deployment(uuid, uuid) TO service_role;