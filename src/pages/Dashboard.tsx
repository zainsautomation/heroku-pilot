import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

interface AppTemplate {
  id: string;
  name: string;
  description: string;
  github_repo_url: string;
  heroku_deploy_url: string;
}

interface Deployment {
  id: string;
  created_at: string;
  status: string;
  heroku_app_url: string | null;
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

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      const [templatesRes, deploymentsRes, limitRes, settingsRes] = await Promise.all([
        supabase.from('app_templates').select('*').order('created_at', { ascending: false }),
        supabase.from('deployments').select('*, app_templates(name)').eq('user_id', user!.id).order('created_at', { ascending: false }),
        supabase.from('deployment_limits').select('*').eq('user_id', user!.id).maybeSingle(),
        supabase.from('system_settings').select('*').eq('setting_key', 'limit_reached_message').maybeSingle(),
      ]);

      if (templatesRes.data) setTemplates(templatesRes.data);
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

  const handleDeploy = async () => {
    if (!selectedTemplate) return;

    // Open Heroku deployment page in new tab
    window.open(selectedTemplate.heroku_deploy_url, '_blank');
    
    // Track the deployment attempt
    try {
      await supabase.from('deployments').insert({
        user_id: user!.id,
        app_template_id: selectedTemplate.id,
        status: 'pending',
      });
      
      toast.success('Opened Heroku deployment page. Complete the deployment in the new tab.');
      setSelectedTemplate(null);
      fetchData();
    } catch (error) {
      console.error('Error tracking deployment:', error);
    }
  };

  const handleDeleteDeployment = async (deploymentId: string) => {
    try {
      const { error } = await supabase.from('deployments').delete().eq('id', deploymentId);
      if (error) throw error;
      
      toast.success('Deployment deleted');
      fetchData();
    } catch (error: any) {
      console.error('Error deleting deployment:', error);
      toast.error(error.message || 'Failed to delete deployment');
    }
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
                      onClick={() => setSelectedTemplate(template)}
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

      <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deployment</DialogTitle>
            <DialogDescription>
              Are you sure you want to deploy {selectedTemplate?.name}?
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
              Cancel
            </Button>
            <Button onClick={handleDeploy}>
              Open Heroku Deploy
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
                  <TableHead>App</TableHead>
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
                      <Badge variant={deployment.status === 'success' ? 'default' : 'destructive'}>
                        {deployment.status}
                      </Badge>
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
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(deployment.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDeployment(deployment.id)}
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
