import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Rocket, LogOut, Plus, Users, Package, Settings, BarChart, Download, Check, X, Loader2, Trash2, Search, Shield, Key } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { z } from 'zod';

const githubUrlSchema = z.string()
  .url('Must be a valid URL')
  .regex(/^https:\/\/github\.com\/[^/]+\/[^/]+/, 'Must be a valid GitHub repository URL');

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  description: z.string().trim().min(1, 'Description is required').max(500, 'Description must be less than 500 characters'),
  github_repo_url: githubUrlSchema,
  default_app_name: z.string().trim().max(30, 'Default app name must be 30 characters or less')
    .regex(/^[a-z0-9-]*$/, 'Must be lowercase letters, numbers, and hyphens only')
    .optional(),
  config_vars_metadata: z.array(z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    defaultValue: z.string().max(1000),
    required: z.boolean()
  })).optional()
});
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  created_at: string;
  config_vars_metadata?: ConfigVarMetadata[];
  default_app_name?: string;
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
    config_vars_metadata: [] as ConfigVarMetadata[],
    default_app_name: '',
  });
  
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [newLimit, setNewLimit] = useState('');
  const [fetchingConfig, setFetchingConfig] = useState(false);
  const [detectedVars, setDetectedVars] = useState<ConfigVarMetadata[]>([]);
  const [showVarsDialog, setShowVarsDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

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

      if (templatesRes.error) throw templatesRes.error;
      if (settingsRes.error) throw settingsRes.error;
      if (templatesRes.data) {
        setTemplates(templatesRes.data.map(t => ({
          ...t,
          config_vars_metadata: (t.config_vars_metadata as any) || []
        })));
      }
      if (settingsRes.data) setSystemMessage(settingsRes.data.setting_value);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    const [profilesRes, rolesRes, limitsRes, deploymentCountsRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('user_roles').select('*'),
      supabase.from('deployment_limits').select('*'),
      supabase
      .from('deployments')
      .select('user_id, status')
      .in('status', ['success', 'pending']),
    ]);
    const queryError = [profilesRes.error, rolesRes.error, limitsRes.error, deploymentCountsRes.error].find(Boolean);
    if (queryError) throw queryError;
    const { data: profiles } = profilesRes;
    const { data: roles } = rolesRes;
    const { data: limits } = limitsRes;
    const { data: deploymentCounts } = deploymentCountsRes;

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
          max_deployments: userLimit?.max_deployments || 0,
          deployment_count: userDeployments,
        };
      });

      setUsers(userData);
    }
  };

  const fetchDeployments = async () => {
      const { data: deploymentRows, error } = await supabase
      .from('deployments')
      .select(`
        id,
          user_id,
          app_template_id,
        created_at,
          status,
          heroku_app_name
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (deploymentRows) {
      const userIds = [...new Set(deploymentRows.map((row) => row.user_id))];
      const templateIds = [...new Set(deploymentRows.map((row) => row.app_template_id))];
      const [profilesRes, templatesRes] = await Promise.all([
        supabase.from('profiles').select('id, email').in('id', userIds),
        supabase.from('app_templates').select('id, name').in('id', templateIds),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (templatesRes.error) throw templatesRes.error;
      setDeployments(
        deploymentRows.map((d) => ({
          id: d.id,
          created_at: d.created_at,
          status: d.status,
          user_email: profilesRes.data?.find((profile) => profile.id === d.user_id)?.email || 'Unknown',
          app_name: d.heroku_app_name || templatesRes.data?.find((template) => template.id === d.app_template_id)?.name || 'Unknown',
        }))
      );
    }
  };

  const handleFetchConfig = async () => {
    if (!newTemplate.github_repo_url) {
      toast.error("Please enter a GitHub URL first");
      return;
    }

    setFetchingConfig(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-github-config', {
        body: { repoUrl: newTemplate.github_repo_url }
      });

      if (error) throw error;

      if (data.error) {
        toast.error(data.error);
        if (data.hint) {
          toast.info(data.hint);
        }
      } else {
        setDetectedVars(data.variables);
        setShowVarsDialog(true);
        toast.success(`Found ${data.count} environment variables`);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
      toast.error("Failed to fetch config from GitHub");
    } finally {
      setFetchingConfig(false);
    }
  };

  const handleAcceptVars = () => {
    setNewTemplate(prev => ({
      ...prev,
      config_vars_metadata: detectedVars
    }));
    setShowVarsDialog(false);
    toast.success(`Added ${detectedVars.length} environment variables`);
  };

  const handleAddTemplate = async () => {
    try {
      // Validate template data
      const validatedTemplate = templateSchema.parse(newTemplate);
      
      const herokuUrl = `https://dashboard.heroku.com/new?template=${validatedTemplate.github_repo_url}`;
      
      const { error } = await supabase.from('app_templates').insert({
        name: validatedTemplate.name,
        description: validatedTemplate.description,
        github_repo_url: validatedTemplate.github_repo_url,
        heroku_deploy_url: herokuUrl,
        config_vars: (validatedTemplate.config_vars_metadata || []).map(v => v.name) as any,
        config_vars_metadata: validatedTemplate.config_vars_metadata as any,
        default_app_name: validatedTemplate.default_app_name || null,
        created_by: (await supabase.auth.getUser()).data.user!.id,
      });

      if (error) throw error;

      toast.success('Template added successfully');
      setNewTemplate({ 
        name: '', 
        description: '', 
        github_repo_url: '', 
        config_vars_metadata: [],
        default_app_name: '',
      });
      setDetectedVars([]);
      fetchData();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else {
        toast.error(error.message);
      }
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
        .upsert({ 
          setting_key: 'limit_reached_message',
          setting_value: systemMessage 
        }, {
          onConflict: 'setting_key'
        });

      if (error) throw error;

      toast.success('System message updated');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!window.confirm('Delete this template? Existing deployment records will be retained.')) return;
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

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    if (role !== 'admin') {
      toast.error('Only admins can delete users');
      return;
    }

    if (!confirm(`Are you sure you want to delete user: ${userEmail}?\n\nThis will delete:\n- User profile\n- All deployments\n- Deployment limits\n- User roles\n\nThis action cannot be undone.`)) {
      return;
    }

    setDeletingUser(userId);
    try {
      // Delete user from auth.users using admin API
      const { error } = await supabase.auth.admin.deleteUser(userId);

      if (error) throw error;

      toast.success('User deleted successfully');
      fetchData();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user: ' + error.message);
    } finally {
      setDeletingUser(null);
    }
  };

  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 rounded-lg bg-primary/10">
                <Rocket className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg sm:text-2xl font-bold">Admin Dashboard</h1>
                <Badge variant="outline" className="mt-0.5 sm:mt-1 text-xs">
                  {role === 'admin' ? 'Administrator' : 'Moderator'}
                </Badge>
              </div>
            </div>
            
            <div className="flex items-center gap-1 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/dashboard')} className="hidden sm:flex">
                <Shield className="mr-2 h-4 w-4" /> Apps
              </Button>
              <Button variant="outline" size="icon" aria-label="Open app dashboard" title="App dashboard" onClick={() => window.location.assign('/dashboard')} className="sm:hidden">
                <Shield className="h-4 w-4" />
              </Button>
              <ThemeToggle />
              <Button 
                variant="outline" 
                size="sm"
                onClick={signOut}
                className="hidden sm:flex"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
              <Button 
                variant="outline" 
                size="icon"
                onClick={signOut}
                className="sm:hidden"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 h-auto">
            <TabsTrigger value="users" className="flex-col sm:flex-row gap-1 sm:gap-2 py-2 sm:py-1.5">
              <Users className="h-4 w-4" />
              <span className="text-xs sm:text-sm">Users</span>
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex-col sm:flex-row gap-1 sm:gap-2 py-2 sm:py-1.5">
              <Package className="h-4 w-4" />
              <span className="text-xs sm:text-sm">Templates</span>
            </TabsTrigger>
            <TabsTrigger value="deployments" className="flex-col sm:flex-row gap-1 sm:gap-2 py-2 sm:py-1.5">
              <BarChart className="h-4 w-4" />
              <span className="text-xs sm:text-sm">Deploys</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-col sm:flex-row gap-1 sm:gap-2 py-2 sm:py-1.5">
              <Settings className="h-4 w-4" />
              <span className="text-xs sm:text-sm">Settings</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card className="shadow-elevated">
              <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>View and manage user accounts and limits</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users by email or name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {searchQuery && (
                    <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                      Clear
                    </Button>
                  )}
                </div>

                {role === 'admin' && (
                  <Alert>
                    <AlertDescription className="text-sm">
                      ⚠️ Admin actions: You can change user roles, update deployment limits, and delete users. User deletion is permanent and will remove all associated data.
                    </AlertDescription>
                  </Alert>
                )}

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
                    {filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUsers.map((user) => (
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
                          <div className="flex items-center gap-2">
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
                            {role === 'admin' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteUser(user.id, user.email)}
                                disabled={deletingUser === user.id}
                              >
                                {deletingUser === user.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      ))
                    )}
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
                    <Label>Default Heroku App Name (Optional)</Label>
                    <Input
                      value={newTemplate.default_app_name}
                      onChange={(e) =>
                        setNewTemplate({ ...newTemplate, default_app_name: e.target.value })
                      }
                      placeholder="my-app (timestamp will be added)"
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional prefix for Heroku app names. Example: my-app becomes my-app-1234567890
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>GitHub Repository URL</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newTemplate.github_repo_url}
                        onChange={(e) =>
                          setNewTemplate({ ...newTemplate, github_repo_url: e.target.value })
                        }
                        placeholder="https://github.com/user/repo"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleFetchConfig}
                        disabled={fetchingConfig || !newTemplate.github_repo_url}
                        title="Auto-fetch environment variables from GitHub config files"
                      >
                        {fetchingConfig ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Environment Variables</Label>
                    {newTemplate.config_vars_metadata.length > 0 ? (
                      <ScrollArea className="h-64 border rounded-md p-4">
                        <div className="space-y-4">
                          {newTemplate.config_vars_metadata.map((varMeta, idx) => (
                            <div key={idx} className="p-3 border rounded-lg space-y-2 bg-card">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                                    {varMeta.name}
                                  </code>
                                  {varMeta.required && (
                                    <Badge variant="destructive" className="text-xs">Required</Badge>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const updated = newTemplate.config_vars_metadata.filter((_, i) => i !== idx);
                                    setNewTemplate({
                                      ...newTemplate,
                                      config_vars_metadata: updated
                                    });
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              <Input
                                placeholder="Description (what is this for?)"
                                value={varMeta.description}
                                onChange={(e) => {
                                  const updated = [...newTemplate.config_vars_metadata];
                                  updated[idx] = { ...updated[idx], description: e.target.value };
                                  setNewTemplate({ ...newTemplate, config_vars_metadata: updated });
                                }}
                              />
                              <Input
                                placeholder="Default value (optional)"
                                value={varMeta.defaultValue}
                                onChange={(e) => {
                                  const updated = [...newTemplate.config_vars_metadata];
                                  updated[idx] = { ...updated[idx], defaultValue: e.target.value };
                                  setNewTemplate({ ...newTemplate, config_vars_metadata: updated });
                                }}
                              />
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  id={`required-${idx}`}
                                  checked={varMeta.required}
                                  onChange={(e) => {
                                    const updated = [...newTemplate.config_vars_metadata];
                                    updated[idx] = { ...updated[idx], required: e.target.checked };
                                    setNewTemplate({ ...newTemplate, config_vars_metadata: updated });
                                  }}
                                  className="h-4 w-4"
                                />
                                <Label htmlFor={`required-${idx}`} className="text-sm cursor-pointer">
                                  Required field
                                </Label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="text-sm text-muted-foreground p-8 border rounded-md text-center">
                        <p className="mb-2">No environment variables added yet.</p>
                        <p>Use the <Download className="h-4 w-4 inline" /> button to auto-fetch from GitHub.</p>
                      </div>
                    )}
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
            <div className="space-y-6">
              <Card className="shadow-elevated">
                <CardHeader>
                  <CardTitle>System Messages</CardTitle>
                  <CardDescription>Configure system-wide messages</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Deployment Limit Reached Message</Label>
                    <Textarea
                      value={systemMessage}
                      onChange={(e) => setSystemMessage(e.target.value)}
                      placeholder="Message shown when users reach their limit"
                      rows={3}
                    />
                  </div>
                  
                  <Button onClick={handleUpdateSystemMessage}>
                    Save Message
                  </Button>
                </CardContent>
              </Card>

              {(role === 'admin' || role === 'moderator') && (
                <Card className="shadow-elevated border-destructive">
                  <CardHeader>
                    <CardTitle>
                      <div className="flex items-center gap-2">
                        <Key className="h-5 w-5 text-destructive" />
                        Heroku API Configuration
                      </div>
                    </CardTitle>
                    <CardDescription>
                      Set the Heroku API key to enable app deployments
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!herokuApiKey && (
                      <div className="p-4 border border-destructive bg-destructive/10 rounded-lg">
                        <p className="text-sm font-medium text-destructive mb-2">⚠️ No Heroku API Key Set</p>
                        <p className="text-sm text-muted-foreground">
                          Deployments will fail until you add a valid Heroku API key. Get your API key from{' '}
                          <a 
                            href="https://dashboard.heroku.com/account" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="underline hover:text-primary"
                          >
                            Heroku Account Settings
                          </a>
                        </p>
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <Label>Heroku API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          type={showHerokuKey ? "text" : "password"}
                          value={herokuApiKey}
                          onChange={(e) => setHerokuApiKey(e.target.value)}
                          placeholder="Enter Heroku API key"
                          className={!herokuApiKey ? 'border-destructive' : ''}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setShowHerokuKey(!showHerokuKey)}
                        >
                          {showHerokuKey ? '🙈' : '👁️'}
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          This key will be used to deploy apps via Heroku API
                        </p>
                        <p className="text-xs text-muted-foreground">
                          How to get your API key:
                        </p>
                        <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1 ml-2">
                          <li>Go to <a href="https://dashboard.heroku.com/account" target="_blank" rel="noopener noreferrer" className="underline">Heroku Account Settings</a></li>
                          <li>Scroll to "API Key" section</li>
                          <li>Click "Reveal" to see your API key</li>
                          <li>Copy and paste it here</li>
                        </ol>
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button 
                        onClick={handleTestHerokuKey} 
                        disabled={!herokuApiKey || testingApiKey}
                        variant="outline"
                        className="flex-1"
                      >
                        {testingApiKey ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Testing...
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            Test Connection
                          </>
                        )}
                      </Button>
                      <Button 
                        onClick={handleUpdateHerokuKey} 
                        disabled={!herokuApiKey}
                        className="flex-1"
                      >
                        {herokuApiKey ? 'Update' : 'Save'} API Key
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
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

      <Dialog open={showVarsDialog} onOpenChange={setShowVarsDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detected Environment Variables</DialogTitle>
            <DialogDescription>
              Found {detectedVars.length} variables from GitHub with defaults and descriptions
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-96">
            <div className="space-y-3">
              {detectedVars.map((varMeta, idx) => (
                <div key={idx} className="p-3 border rounded-lg space-y-2 bg-card">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{varMeta.name}</code>
                    {varMeta.required && (
                      <Badge variant="destructive" className="text-xs">Required</Badge>
                    )}
                  </div>
                  {varMeta.description && (
                    <p className="text-sm text-muted-foreground">{varMeta.description}</p>
                  )}
                  {varMeta.defaultValue && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Default: </span>
                      <code className="bg-muted px-1 py-0.5 rounded">{varMeta.defaultValue}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVarsDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAcceptVars}>
              Add All Variables
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
