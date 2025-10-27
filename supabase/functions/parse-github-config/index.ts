import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repoUrl } = await req.json();

    if (!repoUrl) {
      throw new Error('Repository URL is required');
    }

    // Extract owner and repo from GitHub URL
    const githubUrlPattern = /github\.com\/([^\/]+)\/([^\/]+)/;
    const match = repoUrl.match(githubUrlPattern);
    
    if (!match) {
      throw new Error('Invalid GitHub URL format');
    }

    const [, owner, repo] = match;
    const repoName = repo.replace(/\.git$/, ''); // Remove .git if present

    console.log(`Fetching config from ${owner}/${repoName}`);

    // List of common config files to check
    const configFiles = [
      'config.js',
      'config.env.js',
      'config/index.js',
      'src/config.js',
      '.env.example',
      'app.json',
    ];

    interface ConfigVar {
      name: string;
      description: string;
      defaultValue: string;
      required: boolean;
    }

    let detectedVars: ConfigVar[] = [];
    let fileFound = false;

    // Try to fetch each config file
    for (const file of configFiles) {
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${file}`;
        console.log(`Checking: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Supabase-Edge-Function',
          },
        });

        if (!response.ok) {
          console.log(`File ${file} not found or inaccessible`);
          continue;
        }

        const data = await response.json();
        
        if (data.content) {
          // Decode base64 content
          const content = atob(data.content);
          console.log(`Successfully fetched ${file}`);
          
          const varsMap = new Map<string, ConfigVar>();

          // Extract environment variables from JavaScript config files
          if (file.endsWith('.js')) {
            // Pattern: VARIABLE_NAME: process.env.VARIABLE_NAME || "default",
            const jsPattern = /([A-Z_][A-Z0-9_]*)\s*:\s*process\.env\.([A-Z_][A-Z0-9_]*)\s*\|\|\s*["']([^"']*)["']\s*,?\s*(?:\/\/\s*(.*))?/g;
            let match;
            
            while ((match = jsPattern.exec(content)) !== null) {
              const [, varKey, envVar, defaultVal, comment] = match;
              varsMap.set(envVar, {
                name: envVar,
                description: comment?.trim() || '',
                defaultValue: defaultVal || '',
                required: !defaultVal, // If no default, mark as required
              });
            }

            // Also check for simple process.env.VARIABLE_NAME patterns
            const simplePattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
            while ((match = simplePattern.exec(content)) !== null) {
              const varName = match[1];
              if (!varsMap.has(varName)) {
                varsMap.set(varName, {
                  name: varName,
                  description: '',
                  defaultValue: '',
                  required: false,
                });
              }
            }
          }

          // Check for .env.example format (KEY=value)
          if (file.includes('.env')) {
            const envPattern = /^([A-Z_][A-Z0-9_]*)\s*=\s*([^\n\r]*?)(?:\s*#\s*(.*))?$/gm;
            let match;
            
            while ((match = envPattern.exec(content)) !== null) {
              const [, varName, defaultVal, comment] = match;
              varsMap.set(varName, {
                name: varName,
                description: comment?.trim() || '',
                defaultValue: defaultVal?.trim() || '',
                required: !defaultVal?.trim(),
              });
            }
          }

          // Check for app.json format (Heroku)
          if (file === 'app.json') {
            try {
              const appJson = JSON.parse(content);
              if (appJson.env) {
                Object.entries(appJson.env).forEach(([key, config]: [string, any]) => {
                  varsMap.set(key, {
                    name: key,
                    description: config.description || '',
                    defaultValue: config.value || '',
                    required: config.required !== false,
                  });
                });
              }
            } catch (e) {
              console.error('Error parsing app.json:', e);
            }
          }

          if (varsMap.size > 0) {
            detectedVars = Array.from(varsMap.values());
            fileFound = true;
            console.log(`Found ${detectedVars.length} variables in ${file}`);
            break; // Stop after finding first config file with variables
          }
        }
      } catch (error) {
        console.error(`Error fetching ${file}:`, error);
        continue;
      }
    }

    if (!fileFound || detectedVars.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No config file found or no environment variables detected',
          hint: 'Make sure the repository is public and contains one of: config.js, .env.example, or app.json'
        }),
        { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        variables: detectedVars,
        count: detectedVars.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in parse-github-config:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
