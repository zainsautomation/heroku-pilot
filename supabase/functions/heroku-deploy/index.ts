import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeployRequest {
  templateId: string;
  configVars: Record<string, string>;
  appName?: string;
  branch?: string;
}

interface DeleteRequest {
  appName: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client for user authentication
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Create separate service role client for database access (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user authentication
    const { data: { user }, error: userError } = await authClient.auth.getUser();

    if (userError || !user) {
      console.error('Auth error:', userError);
      throw new Error('Unauthorized');
    }

    console.log('Authenticated user:', user.id);

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'create'; // Default to 'create' if no action

    // Get Heroku API key - prefer environment variable (secure), fallback to database
    let herokuApiKey = Deno.env.get('HEROKU_API_KEY');
    
    if (!herokuApiKey) {
      console.warn('HEROKU_API_KEY not found in secrets, using database fallback (insecure)');
      const { data: settingData, error: settingError } = await serviceClient
        .from('system_settings')
        .select('setting_value')
        .eq('setting_key', 'heroku_api_key')
        .maybeSingle();

      if (settingError) {
        console.error('Error fetching Heroku API key:', settingError);
        throw new Error('Configuration error');
      }

      if (!settingData || !settingData.setting_value) {
        throw new Error('Heroku API key not configured');
      }

      herokuApiKey = settingData.setting_value.trim();
    }
    
    // Validate API key format
    if (!herokuApiKey || herokuApiKey.length < 20) {
      throw new Error('Configuration error');
    }
    
    console.log('Heroku API key loaded successfully');

    if (action === 'create') {
      const { templateId, configVars, appName: customAppName, branch }: DeployRequest = await req.json();

      console.log('Creating Heroku deployment for template:', templateId);
      console.log('Config vars:', configVars);
      console.log('Custom app name:', customAppName);
      console.log('Branch:', branch || 'auto-detect');

      // SERVER-SIDE DEPLOYMENT LIMIT CHECK
      console.log('Checking deployment limit for user:', user.id);
      
      // Fetch user's deployment limit
      const { data: limitData, error: limitError } = await serviceClient
        .from('deployment_limits')
        .select('max_deployments')
        .eq('user_id', user.id)
        .single();

      if (limitError) {
        console.error('Error fetching deployment limit:', limitError);
        throw new Error('Unable to verify deployment limit');
      }

      // Count existing active deployments (success and pending)
      const { data: existingDeployments, error: deploymentsError } = await serviceClient
        .from('deployments')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['success', 'pending']);

      if (deploymentsError) {
        console.error('Error fetching deployments:', deploymentsError);
        throw new Error('Unable to verify existing deployments');
      }

      const currentDeploymentCount = existingDeployments?.length || 0;
      console.log(`User has ${currentDeploymentCount}/${limitData.max_deployments} deployments`);

      // Enforce deployment limit
      if (currentDeploymentCount >= limitData.max_deployments) {
        console.log('User has reached deployment limit');
        throw new Error('Deployment limit reached');
      }

      // Get template info
      const { data: template, error: templateError } = await serviceClient
        .from('app_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (templateError || !template) {
        console.error('Template error:', templateError);
        throw new Error('Template not found');
      }

      console.log('Template found:', template.name);

      // Extract GitHub repo from URL
      const githubUrl = template.github_repo_url;
      const repoMatch = githubUrl.match(/github\.com\/(.+?)(?:\.git)?$/);
      if (!repoMatch) {
        throw new Error('Invalid GitHub repository URL');
      }
      const repoPath = repoMatch[1].replace(/\.git$/, '');
      console.log('GitHub repo path:', repoPath);

      // Detect default branch if not specified
      let deployBranch = branch;
      if (!deployBranch) {
        console.log('Auto-detecting default branch...');
        try {
          const repoApiResponse = await fetch(`https://api.github.com/repos/${repoPath}`);
          if (repoApiResponse.ok) {
            const repoData = await repoApiResponse.json();
            deployBranch = repoData.default_branch || 'main';
            console.log('Detected default branch:', deployBranch);
          } else {
            deployBranch = 'main';
            console.log('Could not detect branch, defaulting to main');
          }
        } catch (e) {
          deployBranch = 'main';
          console.log('Error detecting branch, defaulting to main:', e);
        }
      }

      // Generate app name
      const baseAppName = customAppName || template.default_app_name || 'app';
      const appName = `${baseAppName}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      console.log('App name:', appName);

      // Use App Setups API (same as "Deploy to Heroku" button)
      // This API properly handles app.json and buildpacks
      console.log('Creating app setup using Heroku App Setups API...');
      const setupPayload = {
        app: {
          name: appName,
        },
        source_blob: {
          url: `https://github.com/${repoPath}/tarball/${deployBranch}/`,
        },
        overrides: configVars && Object.keys(configVars).length > 0 ? {
          env: configVars,
        } : undefined,
      };
      
      console.log('Setup payload:', JSON.stringify(setupPayload, null, 2));
      
      const setupResponse = await fetch('https://api.heroku.com/app-setups', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${herokuApiKey}`,
          'Accept': 'application/vnd.heroku+json; version=3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(setupPayload),
      });

      if (!setupResponse.ok) {
        const errorText = await setupResponse.text();
        console.error('Heroku app setup failed:', errorText);
        let errorMessage = 'Failed to create Heroku app setup';
        
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) {
            errorMessage = errorJson.message;
          }
          if (errorJson.id === 'unauthorized') {
            errorMessage = 'Invalid Heroku API key. Please contact admin to update the API key.';
          }
        } catch (e) {
          errorMessage = errorText;
        }
        
        throw new Error(errorMessage);
      }

      const setupData = await setupResponse.json();
      console.log('App setup created:', setupData.id);
      console.log('App name:', setupData.app.name);
      console.log('Build ID:', setupData.build?.id);
      console.log('Setup status:', setupData.status);
      console.log('Build output URL:', setupData.build?.output_stream_url);

      // Create deployment record
      const { data: deploymentData, error: deployError } = await serviceClient
        .from('deployments')
        .insert({
          user_id: user.id,
          app_template_id: templateId,
          status: 'pending',
          heroku_app_url: `https://${setupData.app.name}.herokuapp.com`,
          heroku_app_name: setupData.app.name,
          build_log_url: setupData.build?.output_stream_url || null,
        })
        .select()
        .single();

      if (deployError) {
        console.error('Failed to create deployment record:', deployError);
        throw new Error('Failed to create deployment record');
      }

      console.log('Deployment record created:', deploymentData.id);

      return new Response(
        JSON.stringify({
          success: true,
          appName: setupData.app.name,
          appUrl: `https://${setupData.app.name}.herokuapp.com`,
          setupId: setupData.id,
          buildId: setupData.build?.id || null,
          deploymentId: deploymentData.id,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'delete') {
      const { appName }: DeleteRequest = await req.json();

      console.log('Deleting Heroku app:', appName);

      // Delete app from Heroku
      const deleteResponse = await fetch(`https://api.heroku.com/apps/${appName}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${herokuApiKey}`,
          'Accept': 'application/vnd.heroku+json; version=3',
        },
      });

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        const error = await deleteResponse.text();
        console.error('Heroku app deletion failed:', error);
        throw new Error(`Failed to delete Heroku app: ${error}`);
      }

      console.log('Heroku app deleted successfully');

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'status') {
      const appName = url.searchParams.get('appName');
      if (!appName) {
        throw new Error('App name required');
      }

      console.log('Checking build status for app:', appName);

      // Get build status
      const buildsResponse = await fetch(`https://api.heroku.com/apps/${appName}/builds`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${herokuApiKey}`,
          'Accept': 'application/vnd.heroku+json; version=3',
          'Range': 'created_at ..; max=1, order=desc',
        },
      });

      if (!buildsResponse.ok) {
        // If app doesn't exist (404), return deleted status instead of error
        if (buildsResponse.status === 404) {
          console.log('App not found on Heroku (likely deleted):', appName);
          return new Response(
            JSON.stringify({
              status: 'deleted',
              buildId: null,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        
        const errorText = await buildsResponse.text();
        console.error('Failed to get build status:', buildsResponse.status, errorText);
        throw new Error(`Failed to get build status: ${buildsResponse.status} - ${errorText}`);
      }

      const builds = await buildsResponse.json();
      console.log('Builds response:', JSON.stringify(builds));
      
      if (builds.length === 0) {
        return new Response(
          JSON.stringify({
            status: 'pending',
            buildId: null,
            buildLogUrl: null,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const latestBuild = builds[0];
      console.log('Latest build status:', latestBuild.status);
      console.log('Latest build log URL:', latestBuild.output_stream_url);

      return new Response(
        JSON.stringify({
          status: latestBuild.status,
          buildId: latestBuild.id,
          buildLogUrl: latestBuild.output_stream_url || null,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'logs') {
      const appName = url.searchParams.get('appName');
      const lines = url.searchParams.get('lines') || '100';
      
      if (!appName) {
        throw new Error('App name required');
      }

      console.log('Fetching app logs for:', appName);

      // Create a log session to get app logs
      const logSessionResponse = await fetch(`https://api.heroku.com/apps/${appName}/log-sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${herokuApiKey}`,
          'Accept': 'application/vnd.heroku+json; version=3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lines: parseInt(lines),
          tail: true,
        }),
      });

      if (!logSessionResponse.ok) {
        if (logSessionResponse.status === 404) {
          return new Response(
            JSON.stringify({ logs: 'App not found or has been deleted.' }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        const error = await logSessionResponse.text();
        console.error('Failed to create log session:', error);
        throw new Error('Failed to fetch app logs');
      }

      const logSession = await logSessionResponse.json();
      const logUrl = logSession.logplex_url;

      // Fetch logs from the log URL
      const logsResponse = await fetch(logUrl);
      const logsText = await logsResponse.text();

      return new Response(
        JSON.stringify({ logs: logsText || 'No logs available yet.' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    throw new Error('Invalid action');
  } catch (error) {
    console.error('Error occurred:', error);
    console.error('Error type:', error instanceof Error ? 'Error' : typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
