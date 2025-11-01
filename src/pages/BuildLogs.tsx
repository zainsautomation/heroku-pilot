import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function BuildLogs() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deploymentId = searchParams.get('id');
  const appName = searchParams.get('appName');
  
  const [buildStatus, setBuildStatus] = useState<string>('pending');
  const [logs, setLogs] = useState<string>('Fetching build logs...');
  const [appUrl, setAppUrl] = useState<string>('');
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!deploymentId || !appName) {
      toast.error('Invalid deployment');
      navigate('/dashboard');
      return;
    }

    fetchDeploymentInfo();
    const interval = setInterval(pollBuildStatus, 3000);

    return () => clearInterval(interval);
  }, [deploymentId, appName]);

  const fetchDeploymentInfo = async () => {
    try {
      const { data, error } = await supabase
        .from('deployments')
        .select('*')
        .eq('id', deploymentId)
        .single();

      if (error) throw error;
      
      if (data) {
        setBuildStatus(data.status);
        setAppUrl(data.heroku_app_url || '');
        
        if (data.status === 'success' || data.status === 'failed') {
          setPolling(false);
        }
      }
    } catch (error: any) {
      console.error('Error fetching deployment:', error);
      toast.error('Failed to load deployment info');
    }
  };

  const pollBuildStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('heroku-deploy', {
        body: JSON.stringify({ action: 'status', appName }),
      });

      if (error) throw error;

      if (data) {
        const status = data.status;
        setBuildStatus(status);

        if (status === 'succeeded') {
          await supabase
            .from('deployments')
            .update({ status: 'success' })
            .eq('id', deploymentId);
          
          setLogs('Build completed successfully!\n\nYour app is now deployed and ready to use.');
          setPolling(false);
          toast.success('Deployment successful!');
        } else if (status === 'failed') {
          await supabase
            .from('deployments')
            .update({ status: 'failed', error_message: 'Build failed on Heroku' })
            .eq('id', deploymentId);
          
          setLogs('Build failed.\n\nPlease check your GitHub repository for issues:\n- Invalid package.json dependencies\n- Missing required files\n- Configuration errors\n\nView detailed logs in your Heroku dashboard.');
          setPolling(false);
          toast.error('Deployment failed');
        } else if (status === 'pending') {
          setLogs('Build is in progress...\n\nThis may take a few minutes. Heroku is:\n1. Downloading your code\n2. Installing dependencies\n3. Building your application\n4. Starting the app\n\nPlease wait...');
        }
      }
    } catch (error: any) {
      console.error('Error polling build status:', error);
    }
  };

  const getStatusColor = () => {
    if (buildStatus === 'success' || buildStatus === 'succeeded') return 'default';
    if (buildStatus === 'failed') return 'destructive';
    return 'secondary';
  };

  const getStatusIcon = () => {
    if (buildStatus === 'success' || buildStatus === 'succeeded') return <CheckCircle className="h-5 w-5" />;
    if (buildStatus === 'failed') return <XCircle className="h-5 w-5" />;
    return <Loader2 className="h-5 w-5 animate-spin" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <h1 className="text-2xl font-bold">Build Logs</h1>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {getStatusIcon()}
                    Build Status
                  </CardTitle>
                  <CardDescription>App: {appName}</CardDescription>
                </div>
                <Badge variant={getStatusColor() as any} className="text-base px-4 py-2">
                  {buildStatus}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 w-full rounded-md border bg-muted/50 p-4">
                <pre className="text-sm font-mono whitespace-pre-wrap">{logs}</pre>
              </ScrollArea>
            </CardContent>
          </Card>

          {appUrl && (buildStatus === 'success' || buildStatus === 'succeeded') && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle>Your App is Live!</CardTitle>
                <CardDescription>Click below to view your deployed application</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button 
                    onClick={() => window.open(appUrl, '_blank')}
                    className="flex-1"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View App
                  </Button>
                  <Button 
                    onClick={() => window.open(`https://dashboard.heroku.com/apps/${appName}/logs`, '_blank')}
                    variant="outline"
                  >
                    View Heroku Logs
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>App URL: <code className="bg-muted px-2 py-1 rounded">{appUrl}</code></p>
                </div>
              </CardContent>
            </Card>
          )}

          {buildStatus === 'failed' && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Build Failed</CardTitle>
                <CardDescription>Common issues and solutions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-semibold">Check your GitHub repository for:</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Invalid or non-existent npm packages in package.json</li>
                  <li>Missing required environment variables</li>
                  <li>Incorrect Node.js version specified</li>
                  <li>Missing Procfile or incorrect start command</li>
                </ul>
                <Button 
                  onClick={() => window.open(`https://dashboard.heroku.com/apps/${appName}`, '_blank')}
                  variant="outline"
                  className="mt-4"
                >
                  View Full Logs on Heroku
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
