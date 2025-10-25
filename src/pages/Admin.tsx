import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Rocket, LogOut, Plus, Users, Package, Settings, BarChart } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface UserData {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  max_deployments: number;
  deployment_count: number;
}

interface AppTemplate {
  id: string;
  name: string;
  description: string;
  github_repo_url: string;
  heroku_deploy_url: string;
  created_at: string;
}

interface Deployment {
  id: string;
  created_at: string;
  status: string;
  user_email: string;
  app_name: string;
}

export default function Admin() {
  const { role, signOut } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [systemMessage, setSystemMessage] = useState('');
  
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    description: '',
    github_repo_url: '',
  });
  
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [newLimit, setNewLimit] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [usersRes, templatesRes, deploymentsRes, settingsRes] = await Promise.all([
        fetchUsers(),
        supabase.from('app_templates').select('*').order('created_at', { ascending: false }),
        fetchDeployments(),
        supabase.from('system_settings').select('*').eq('setting_key', 'limit_reached_message').maybeSingle(),
      ]);

      if (templatesRes.data) setTemplates(templatesRes.data);
      if (settingsRes.data) setSystemMessage(settingsRes.data.setting_value);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    const { data: profiles } = await supabase.from('profiles').select('*');
    const { data: roles } = await supabase.from('user_roles').select('*');
    const { data: limits } = await supabase.from('deployment_limits').select('*');
    const { data: deploymentCounts } = await supabase
      .from('deployments')
      .select('user_id, status')
      .eq('status', 'success');

    if (profiles && roles && limits) {
      const userData = profiles.map((profile) => {
        const userRole = roles.find((r) => r.user_id === profile.id);
        const userLimit = limits.find((l) => l.user_id === profile.id);
        const userDeployments = deploymentCounts?.filter(
          (d) => d.user_id === profile.id
        ).length || 0;

        return {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          role: userRole?.role || 'user',
          max_deployments: userLimit?.max_deployments || 5,
          deployment_count: userDeployments,
        };
      });

      setUsers(userData);
    }
  };

  const fetchDeployments = async () => {
    const { data } = await supabase
      .from('deployments')
      .select(`
        id,
        created_at,
        status,
        profiles!deployments_user_id_fkey(email),
        app_templates(name)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (data) {
      setDeployments(
        data.map((d: any) => ({
          id: d.id,
          created_at: d.created_at,
          status: d.status,
          user_email: d.profiles?.email || 'Unknown',
          app_name: d.app_templates?.name || 'Unknown',
        }))
      );
    }
  };

  const handleAddTemplate = async () => {
    if (!newTemplate.name || !newTemplate.description || !newTemplate.github_repo_url) {
      toast.error('All fields are required');
      return;
    }

    try {
      const herokuUrl = `https://heroku.com/deploy?template=${newTemplate.github_repo_url}`;
      
      const { error } = await supabase.from('app_templates').insert({
        ...newTemplate,
        heroku_deploy_url: herokuUrl,
        created_by: (await supabase.auth.getUser()).data.user!.id,
      });

      if (error) throw error;

      toast.success('Template added successfully');
      setNewTemplate({ name: '', description: '', github_repo_url: '' });
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleUpdateLimit = async () => {
    if (!selectedUser || !newLimit) return;

    try {
      const { error } = await supabase
        .from('deployment_limits')
        .update({ max_deployments: parseInt(newLimit) })
        .eq('user_id', selectedUser.id);

      if (error) throw error;

      toast.success('Limit updated successfully');
      setSelectedUser(null);
      setNewLimit('');
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleUpdateSystemMessage = async () => {
    try {
      const { error } = await supabase
        .from('system_settings')
        .update({ setting_value: systemMessage })
        .eq('setting_key', 'limit_reached_message');

      if (error) throw error;

      toast.success('System message updated');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      const { error } = await supabase.from('app_templates').delete().eq('id', id);
      if (error) throw error;
      toast.success('Template deleted');
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (role !== 'admin') {
      toast.error('Only admins can change roles');
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from('user_roles')
        .insert([{ user_id: userId, role: newRole as any }]);

      if (insertError) throw insertError;

      toast.success('Role updated successfully');
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading admin panel...</p>
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
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <Badge variant="outline" className="mt-1">{role === 'admin' ? 'Administrator' : 'Moderator'}</Badge>
            </div>
          </div>
          
          <Button variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="users">
              <Users className="h-4 w-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="templates">
              <Package className="h-4 w-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="deployments">
              <BarChart className="h-4 w-4 mr-2" />
              Deployments
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card className="shadow-elevated">
              <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>View and manage user accounts and limits</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Deployments</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.full_name || 'N/A'}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          {role === 'admin' ? (
                            <Select
                              value={user.role}
                              onValueChange={(value) => handleChangeRole(user.id, value)}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="moderator">Moderator</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge>{user.role}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.deployment_count} / {user.max_deployments}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(user);
                              setNewLimit(user.max_deployments.toString());
                            }}
                          >
                            Update Limit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates">
            <div className="space-y-6">
              <Card className="shadow-elevated">
                <CardHeader>
                  <CardTitle>Add New Template</CardTitle>
                  <CardDescription>Create a new app template for deployment</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>App Name</Label>
                    <Input
                      value={newTemplate.name}
                      onChange={(e) =>
                        setNewTemplate({ ...newTemplate, name: e.target.value })
                      }
                      placeholder="My Awesome App"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={newTemplate.description}
                      onChange={(e) =>
                        setNewTemplate({ ...newTemplate, description: e.target.value })
                      }
                      placeholder="A brief description of the app"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>GitHub Repository URL</Label>
                    <Input
                      value={newTemplate.github_repo_url}
                      onChange={(e) =>
                        setNewTemplate({ ...newTemplate, github_repo_url: e.target.value })
                      }
                      placeholder="https://github.com/user/repo"
                    />
                  </div>
                  
                  <Button onClick={handleAddTemplate} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Template
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-elevated">
                <CardHeader>
                  <CardTitle>Existing Templates</CardTitle>
                  <CardDescription>Manage app templates</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>GitHub URL</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.map((template) => (
                        <TableRow key={template.id}>
                          <TableCell className="font-medium">{template.name}</TableCell>
                          <TableCell>{template.description}</TableCell>
                          <TableCell>
                            <a
                              href={template.github_repo_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              View Repo
                            </a>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteTemplate(template.id)}
                            >
                              Delete
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="deployments">
            <Card className="shadow-elevated">
              <CardHeader>
                <CardTitle>Deployment Logs</CardTitle>
                <CardDescription>View all deployment activity</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>App</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deployments.map((deployment) => (
                      <TableRow key={deployment.id}>
                        <TableCell>{deployment.user_email}</TableCell>
                        <TableCell>{deployment.app_name}</TableCell>
                        <TableCell>
                          <Badge
                            variant={deployment.status === 'success' ? 'default' : 'destructive'}
                          >
                            {deployment.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(deployment.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card className="shadow-elevated">
              <CardHeader>
                <CardTitle>System Settings</CardTitle>
                <CardDescription>Configure system-wide messages</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Deployment Limit Reached Message</Label>
                  <Textarea
                    value={systemMessage}
                    onChange={(e) => setSystemMessage(e.target.value)}
                    placeholder="Message shown when users reach their limit"
                  />
                </div>
                
                <Button onClick={handleUpdateSystemMessage}>
                  Save Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Deployment Limit</DialogTitle>
            <DialogDescription>
              Set new deployment limit for {selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-2">
            <Label>New Limit</Label>
            <Input
              type="number"
              min="0"
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
            />
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateLimit}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
