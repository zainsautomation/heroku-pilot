import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeployRequest {
  templateId: string;
  configVars: Record<string, string>;
  appName?: string;
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

    // Get Heroku API key from system_settings (using service role to bypass RLS)
    const { data: settingData, error: settingError } = await serviceClient
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'heroku_api_key')
      .maybeSingle();

    if (settingError) {
      console.error('Error fetching Heroku API key:', settingError);
      throw new Error('Failed to retrieve Heroku API key from database.');
    }

    if (!settingData || !settingData.setting_value) {
      throw new Error('Heroku API key not configured. Please contact admin.');
    }

    const herokuApiKey = settingData.setting_value.trim();
    
    // Validate API key format
    if (!herokuApiKey || herokuApiKey.length < 20) {
      throw new Error('Invalid Heroku API key format. Please contact admin to update the API key.');
    }
    
    console.log('Using Heroku API key (first 10 chars):', herokuApiKey.substring(0, 10) + '...');

    if (action === 'create') {
      const { templateId, configVars, appName: customAppName }: DeployRequest = await req.json();

      console.log('Creating Heroku app for template:', templateId);
      console.log('Config vars:', configVars);
      console.log('Custom app name:', customAppName);

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

      // Create app on Heroku
      const baseAppName = customAppName || template.default_app_name || 'app';
      const appName = `${baseAppName}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      
      console.log('Creating Heroku app with name:', appName);
      
      const createAppResponse = await fetch('https://api.heroku.com/apps', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${herokuApiKey}`,
          'Accept': 'application/vnd.heroku+json; version=3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: appName,
        }),
      });

      if (!createAppResponse.ok) {
        const errorText = await createAppResponse.text();
        console.error('Heroku app creation failed:', errorText);
        let errorMessage = 'Failed to create Heroku app';
        
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

      const appData = await createAppResponse.json();
      console.log('Heroku app created:', appData.name);

      // Set config vars
      if (configVars && Object.keys(configVars).length > 0) {
        console.log('Setting config vars:', Object.keys(configVars));
        
        const configResponse = await fetch(`https://api.heroku.com/apps/${appData.name}/config-vars`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${herokuApiKey}`,
            'Accept': 'application/vnd.heroku+json; version=3',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(configVars),
        });

        if (!configResponse.ok) {
          const configError = await configResponse.text();
          console.error('Failed to set config vars:', configError);
          // Don't throw error, continue with deployment
        } else {
          console.log('Config vars set successfully');
        }
      } else {
        console.log('No config vars to set');
      }

      // Create build from GitHub
      console.log('Starting build from GitHub...');
      
      const buildResponse = await fetch(`https://api.heroku.com/apps/${appData.name}/builds`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${herokuApiKey}`,
          'Accept': 'application/vnd.heroku+json; version=3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_blob: {
            url: `https://github.com/${repoPath}/tarball/main`,
          },
        }),
      });

      if (!buildResponse.ok) {
        const errorText = await buildResponse.text();
        console.error('Heroku build failed:', errorText);
        
        let errorMessage = 'Failed to start build';
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) {
            errorMessage = errorJson.message;
          }
        } catch (e) {
          errorMessage = errorText;
        }
        
        throw new Error(errorMessage);
      }

      const buildData = await buildResponse.json();
      console.log('Build started:', buildData.id);
      console.log('Build status:', buildData.status);
      console.log('Build output stream URL:', buildData.output_stream_url);

      // Create deployment record
      const { data: deploymentData, error: deployError } = await serviceClient
        .from('deployments')
        .insert({
          user_id: user.id,
          app_template_id: templateId,
          status: 'pending',
          heroku_app_url: `https://${appData.name}.herokuapp.com`,
          heroku_app_name: appData.name,
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
          appName: appData.name,
          appUrl: `https://${appData.name}.herokuapp.com`,
          buildId: buildData.id,
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

      // Get build status
      const buildsResponse = await fetch(`https://api.heroku.com/apps/${appName}/builds`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${herokuApiKey}`,
          'Accept': 'application/vnd.heroku+json; version=3',
          'Range': 'id ..; max=1, order=desc',
        },
      });

      if (!buildsResponse.ok) {
        throw new Error('Failed to get build status');
      }

      const builds = await buildsResponse.json();
      const latestBuild = builds[0];

      return new Response(
        JSON.stringify({
          status: latestBuild?.status || 'unknown',
          buildId: latestBuild?.id,
        }),
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
