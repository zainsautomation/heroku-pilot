import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Rocket, Github, LogOut, History, AlertCircle, Trash2, ExternalLink } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ConfigVarMetadata {
  name: string;
  description: string;
  defaultValue: string;
  required: boolean;
}

interface AppTemplate {
  id: string;
  name: string;
  description: string;
  github_repo_url: string;
  heroku_deploy_url: string;
  config_vars: string[] | null;
  config_vars_metadata?: ConfigVarMetadata[] | null;
  default_app_name?: string | null;
}

interface Deployment {
  id: string;
  created_at: string;
  status: string;
  heroku_app_url: string | null;
  heroku_app_name: string | null;
  error_message: string | null;
  app_templates: {
    name: string;
  } | null;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentLimit, setDeploymentLimit] = useState({ used: 0, max: 5 });
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<AppTemplate | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [limitMessage, setLimitMessage] = useState('');
  const [configVars, setConfigVars] = useState<Record<string, string>>({});
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [appName, setAppName] = useState('');
  const [pollingDeployments, setPollingDeployments] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  useEffect(() => {
    if (deployments.length === 0) return;

    const pendingDeployments = deployments.filter(d => d.status === 'pending');
    if (pendingDeployments.length === 0) return;

    const pollInterval = setInterval(() => {
      pendingDeployments.forEach(deployment => {
        if (deployment.heroku_app_name && !pollingDeployments.has(deployment.id)) {
          pollBuildStatus(deployment.id, deployment.heroku_app_name);
        }
      });
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [deployments]);

  const fetchData = async () => {
    try {
      const [templatesRes, deploymentsRes, limitRes, settingsRes] = await Promise.all([
        supabase.from('app_templates').select('*').order('created_at', { ascending: false }),
        supabase.from('deployments').select('*, app_templates(name)').eq('user_id', user!.id).order('created_at', { ascending: false }),
        supabase.from('deployment_limits').select('*').eq('user_id', user!.id).maybeSingle(),
        supabase.from('system_settings').select('*').eq('setting_key', 'limit_reached_message').maybeSingle(),
      ]);

      if (templatesRes.data) {
        setTemplates(templatesRes.data.map(t => ({
          ...t,
          config_vars: Array.isArray(t.config_vars) ? t.config_vars.map(v => String(v)) : [],
          config_vars_metadata: (t.config_vars_metadata as any) || [],
          default_app_name: t.default_app_name || null
        })));
      }
      if (deploymentsRes.data) {
        setDeployments(deploymentsRes.data);
        const used = deploymentsRes.data.filter(d => d.status === 'success').length;
        setDeploymentLimit(prev => ({ ...prev, used }));
      }
      if (limitRes.data) {
        setDeploymentLimit(prev => ({ ...prev, max: limitRes.data.max_deployments }));
      }
      if (settingsRes.data) {
        setLimitMessage(settingsRes.data.setting_value);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const pollBuildStatus = async (deploymentId: string, appName: string) => {
    if (pollingDeployments.has(deploymentId)) return;

    setPollingDeployments(prev => new Set(prev).add(deploymentId));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await supabase.functions.invoke(`heroku-deploy?action=status&appName=${appName}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        console.error('Failed to get build status:', response.error);
        return;
      }

      const { status } = response.data;

      if (status === 'succeeded') {
        await supabase
          .from('deployments')
          .update({ status: 'success' })
          .eq('id', deploymentId);
        
        toast.success(`Deployment ${appName} completed successfully!`);
        fetchData();
        setPollingDeployments(prev => {
          const next = new Set(prev);
          next.delete(deploymentId);
          return next;
        });
      } else if (status === 'failed') {
        await supabase
          .from('deployments')
          .update({ 
            status: 'failed',
            error_message: 'Build failed on Heroku'
          })
          .eq('id', deploymentId);
        
        toast.error(`Deployment ${appName} failed!`);
        fetchData();
        setPollingDeployments(prev => {
          const next = new Set(prev);
          next.delete(deploymentId);
          return next;
        });
      }
    } catch (error) {
      console.error('Error polling build status:', error);
      setPollingDeployments(prev => {
        const next = new Set(prev);
        next.delete(deploymentId);
        return next;
      });
    }
  };

  const handleDeploy = async () => {
    if (!selectedTemplate || deploying) return;

    // Validate required fields
    const metadata = selectedTemplate.config_vars_metadata || [];
    const missingRequired = metadata.filter(
      meta => meta.required && !configVars[meta.name]
    );

    if (missingRequired.length > 0) {
      toast.error(`Please fill in required fields: ${missingRequired.map(m => m.name).join(', ')}`);
      return;
    }

    setDeploying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('heroku-deploy', {
        body: {
          templateId: selectedTemplate.id,
          configVars,
          appName,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        method: 'POST',
      });

      // Check for errors in the response
      if (response.error) {
        throw new Error(response.error.message || 'Failed to deploy app');
      }

      // Check if the response data contains an error
      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      if (!response.data?.success) {
        throw new Error('Deployment failed: No success response received');
      }

      toast.success(`Deployment started! App: ${response.data.appName}`);
      toast.info(`Building app... This may take a few minutes.`);
      toast.info(`URL: ${response.data.appUrl}`, { duration: 10000 });
      setSelectedTemplate(null);
      setShowConfigDialog(false);
      setConfigVars({});
      setAppName('');
      await fetchData();
    } catch (error: any) {
      console.error('Error deploying app:', error);
      toast.error(error.message || 'Failed to deploy app');
    } finally {
      setDeploying(false);
    }
  };

  const handleDeleteDeployment = async (deploymentId: string, herokuAppName: string | null) => {
    try {
      // Delete from Heroku if app name exists
      if (herokuAppName) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const response = await supabase.functions.invoke('heroku-deploy?action=delete', {
            body: { appName: herokuAppName },
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            method: 'POST',
          });

          if (response.error) {
            console.error('Failed to delete from Heroku:', response.error);
          }
        }
      }

      // Delete from database
      const { error } = await supabase.from('deployments').delete().eq('id', deploymentId);
      if (error) throw error;
      
      toast.success('Deployment deleted');
      fetchData();
    } catch (error: any) {
      console.error('Error deleting deployment:', error);
      toast.error(error.message || 'Failed to delete deployment');
    }
  };

  const updateConfigVar = (key: string, value: string) => {
    setConfigVars(prev => ({ ...prev, [key]: value }));
  };

  const canDeploy = deploymentLimit.used < deploymentLimit.max;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Rocket className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">User Dashboard</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => setShowHistory(true)}>
              <History className="h-4 w-4 mr-2" />
              History
            </Button>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card className="mb-8 shadow-elevated">
          <CardHeader>
            <CardTitle>Deployment Limit</CardTitle>
            <CardDescription>Track your deployment usage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold">
                  {deploymentLimit.used} / {deploymentLimit.max}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Deployments used</p>
              </div>
              
              {!canDeploy && limitMessage && (
                <div className="flex items-center gap-2 text-warning">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm">{limitMessage}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-2xl font-bold mb-6">Available Apps</h2>
          
          {templates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No apps available yet. Check back later!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {templates.map((template) => (
                <Card key={template.id} className="gradient-card hover:shadow-glow transition-all duration-300">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Github className="h-5 w-5 text-primary" />
                      {template.name}
                    </CardTitle>
                    <CardDescription>{template.description}</CardDescription>
                  </CardHeader>
                  
                  <CardFooter>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setSelectedTemplate(template);
                        // Initialize config vars with default values
                        const initialVars: Record<string, string> = {};
                        template.config_vars_metadata?.forEach(varMeta => {
                          initialVars[varMeta.name] = varMeta.defaultValue || '';
                        });
                        setConfigVars(initialVars);
                        setAppName('');
                        setShowConfigDialog(true);
                      }}
                      disabled={!canDeploy}
                    >
                      <Rocket className="h-4 w-4 mr-2" />
                      Deploy
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <Dialog open={showConfigDialog} onOpenChange={(open) => {
        if (!open) {
          setShowConfigDialog(false);
          setSelectedTemplate(null);
          setConfigVars({});
          setAppName('');
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configure Deployment</DialogTitle>
            <DialogDescription>
              Configure settings for {selectedTemplate?.name}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appName">
                  Heroku App Name <span className="text-muted-foreground">(Optional)</span>
                </Label>
                <Input
                  id="appName"
                  type="text"
                  placeholder={`${selectedTemplate?.default_app_name || 'app'}-1234567890`}
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to auto-generate. A timestamp will be added automatically.
                </p>
              </div>

              {selectedTemplate?.config_vars_metadata && selectedTemplate.config_vars_metadata.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Environment Variables</p>
                  {selectedTemplate.config_vars_metadata.map((varMeta) => (
                    <div key={varMeta.name} className="space-y-2 p-3 border rounded-lg bg-card">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={varMeta.name} className="font-mono text-sm">
                          {varMeta.name}
                        </Label>
                        {varMeta.required && (
                          <Badge variant="destructive" className="text-xs">Required</Badge>
                        )}
                      </div>
                      {varMeta.description && (
                        <p className="text-xs text-muted-foreground">{varMeta.description}</p>
                      )}
                      <Input
                        id={varMeta.name}
                        type="text"
                        placeholder={varMeta.defaultValue || `Enter ${varMeta.name}`}
                        value={configVars[varMeta.name] || ''}
                        onChange={(e) => updateConfigVar(varMeta.name, e.target.value)}
                        required={varMeta.required}
                        className={varMeta.required && !configVars[varMeta.name] ? 'border-destructive' : ''}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No environment variables required for this template.
                </p>
              )}
            </div>
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowConfigDialog(false);
              setSelectedTemplate(null);
              setConfigVars({});
              setAppName('');
            }}>
              Cancel
            </Button>
            <Button onClick={handleDeploy} disabled={deploying}>
              {deploying ? 'Deploying...' : 'Deploy App'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Deployment History</DialogTitle>
            <DialogDescription>View all your past deployments</DialogDescription>
          </DialogHeader>
          
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>App Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((deployment) => (
                  <TableRow key={deployment.id}>
                    <TableCell>{deployment.app_templates?.name || 'Unknown'}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {deployment.heroku_app_name || 'N/A'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={
                          deployment.status === 'success' ? 'default' : 
                          deployment.status === 'pending' ? 'secondary' : 
                          'destructive'
                        }
                      >
                        {deployment.status === 'pending' && pollingDeployments.has(deployment.id) ? 'Building...' : deployment.status}
                      </Badge>
                      {deployment.error_message && (
                        <p className="text-xs text-destructive mt-1">{deployment.error_message}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {deployment.heroku_app_url ? (
                        <a
                          href={deployment.heroku_app_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline flex items-center gap-1"
                        >
                          View App <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(deployment.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDeployment(deployment.id, deployment.heroku_app_name || null)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
