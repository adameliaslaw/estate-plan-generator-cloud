import { useState } from 'react';
import { useCollection } from '@/hooks/useFirestore';
import { COLLECTIONS } from '@/config/constants';
import { where } from 'firebase/firestore';
import type { User, UserRole, UserCapability } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Users, Plus, Loader2, Mail, Shield, Settings2 } from 'lucide-react';
import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

interface TeamTabProps {
  firmId: string;
}

const CAPABILITY_OPTIONS: { id: UserCapability; label: string; description: string }[] = [
  { id: 'manage_firm_settings', label: 'Manage Firm Settings', description: 'Edit firm profile, branding, and integrations.' },
  { id: 'manage_users', label: 'Manage Users', description: 'Invite and manage other staff members.' },
  { id: 'manage_clients', label: 'Manage Clients', description: 'Create, edit, archive, and delete clients.' },
  { id: 'manage_documents', label: 'Manage Documents', description: 'Draft, edit, and finalize legal documents.' },
  { id: 'manage_billing', label: 'Manage Billing', description: 'View, create, and delete payment records.' },
];

const DEFAULT_ROLE_CAPABILITIES: Record<UserRole, UserCapability[]> = {
  admin: ['manage_firm_settings', 'manage_users', 'manage_clients', 'manage_documents', 'manage_billing'],
  attorney: ['manage_clients', 'manage_documents', 'manage_billing'],
  paralegal: ['manage_documents'],
  client: [],
};

export function TeamTab({ firmId }: TeamTabProps) {
  const { data: users, loading } = useCollection<User>(COLLECTIONS.USERS(firmId), [
    where('firmId', '==', firmId),
  ]);

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  
  // New user form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('paralegal');
  const [capabilities, setCapabilities] = useState<UserCapability[]>(DEFAULT_ROLE_CAPABILITIES['paralegal']);

  // Edit user capabilities state
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editCapabilities, setEditCapabilities] = useState<UserCapability[]>([]);

  // Function to handle role change
  const handleRoleChange = (val: UserRole, isEdit: boolean = false) => {
    if (isEdit) {
      // In edit mode we just don't change the role for now, as updating capabilities is separate.
    } else {
      setRole(val);
      setCapabilities([...DEFAULT_ROLE_CAPABILITIES[val]]);
    }
  };

  const handleCreateUser = async () => {
    if (!firstName || !lastName || !email) {
      toast.error('Please fill in all required fields.');
      return;
    }

    setIsCreating(true);
    try {
      const createFirmUser = httpsCallable(functions, 'createFirmUser');
      await createFirmUser({
        email,
        firstName,
        lastName,
        role,
        capabilities,
        firmId,
      });

      toast.success('Staff member created. An invitation email has been sent.');
      setIsAddUserOpen(false);
      // Reset form
      setFirstName('');
      setLastName('');
      setEmail('');
      setRole('paralegal');
      setCapabilities([...DEFAULT_ROLE_CAPABILITIES['paralegal']]);
    } catch (err: unknown) {
      console.error('Error creating user:', err);
      toast.error((err as Error).message || 'Failed to create staff member.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditClick = (user: User) => {
    setEditingUser(user);
    if (user.customCapabilities) {
      setEditCapabilities([...user.customCapabilities]);
    } else {
      setEditCapabilities([...DEFAULT_ROLE_CAPABILITIES[user.role]]);
    }
    setIsEditUserOpen(true);
  };

  const handleUpdateCapabilities = async () => {
    if (!editingUser) return;
    setIsUpdating(true);
    try {
      const updateUserCapabilities = httpsCallable(functions, 'updateUserCapabilities');
      await updateUserCapabilities({
        firmId,
        userId: editingUser.id,
        capabilities: editCapabilities,
      });

      toast.success(`${editingUser.firstName}'s capabilities updated successfully.`);
      setIsEditUserOpen(false);
    } catch (err: unknown) {
      console.error('Error updating user capabilities:', err);
      toast.error((err as Error).message || 'Failed to update user capabilities.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-[#1a365d]">
              <Users className="h-5 w-5" />
              Team Members
            </CardTitle>
            <CardDescription>
              Manage attorneys and staff with access to your firm.
            </CardDescription>
          </div>
        <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]">
              <Plus className="h-4 w-4" />
              Add Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Staff Member</DialogTitle>
              <DialogDescription>
                Create a new account for a staff member. They will receive an email to set their password.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane.doe@firm.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(val: UserRole) => handleRoleChange(val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="attorney">Attorney</SelectItem>
                    <SelectItem value="paralegal">Paralegal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Matrix display for Creation Modal */}
              <div className="space-y-4 pt-4 border-t">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-gray-900">Custom Capabilities</h4>
                  <p className="text-xs text-gray-500">Fine-tune the access permissions for this member.</p>
                </div>
                <div className="space-y-3 pl-1">
                  {CAPABILITY_OPTIONS.map((cap) => (
                    <div key={cap.id} className="flex items-start space-x-3">
                      <Checkbox
                        id={`new-${cap.id}`}
                        checked={capabilities.includes(cap.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setCapabilities((prev) => [...prev, cap.id]);
                          } else {
                            setCapabilities((prev) => prev.filter((c) => c !== cap.id));
                          }
                        }}
                      />
                      <div className="space-y-1 leading-none">
                        <label
                          htmlFor={`new-${cap.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {cap.label}
                        </label>
                        <p className="text-xs text-gray-500">{cap.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddUserOpen(false)} disabled={isCreating}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreateUser} 
                className="bg-[#2b6cb0] hover:bg-[#1a365d]"
                disabled={isCreating}
              >
                {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : users && users.length > 0 ? (
          <div className="rounded-md border">
            {users.map((user, i) => (
              <div
                key={user.id}
                className={`flex items-center justify-between p-4 ${
                  i !== users.length - 1 ? 'border-b' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ebf4ff] font-semibold text-[#2b6cb0]">
                    {user.firstName?.[0]}
                    {user.lastName?.[0]}
                  </div>
                  <div>
                    <p className="font-medium text-[#1a365d]">
                      {user.firstName} {user.lastName}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {user.email}
                      </span>
                      <span>&bull;</span>
                      <span className="flex items-center gap-1 capitalize">
                        <Shield className="h-3 w-3" />
                        {user.role}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      user.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => handleEditClick(user)}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Access
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-4 h-12 w-12 text-gray-300" />
            <p className="text-lg font-medium text-gray-900">No team members yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Add your first staff member to collaborate on estate plans.
            </p>
          </div>
        )}
      </CardContent>
    </Card>

    {/* Edit Capabilities Dialog */}
    <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User Capabilities</DialogTitle>
          <DialogDescription>
            Modify {editingUser?.firstName}'s specific access capabilities within the firm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1 mb-4">
            <h4 className="text-sm font-medium text-gray-900">Custom Capabilities Checklist</h4>
            <p className="text-xs text-gray-500">
              Users inherit default capabilities unless overridden here.
            </p>
          </div>

          <div className="space-y-3 border rounded-lg p-4 bg-gray-50/50">
            {CAPABILITY_OPTIONS.map((cap) => (
              <div key={cap.id} className="flex items-start space-x-3">
                <Checkbox
                  id={`edit-${cap.id}`}
                  checked={editCapabilities.includes(cap.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setEditCapabilities((prev) => [...prev, cap.id]);
                    } else {
                      setEditCapabilities((prev) => prev.filter((c) => c !== cap.id));
                    }
                  }}
                />
                <div className="space-y-1 leading-none">
                  <label
                    htmlFor={`edit-${cap.id}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {cap.label}
                  </label>
                  <p className="text-xs text-gray-500">{cap.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsEditUserOpen(false)} disabled={isUpdating}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdateCapabilities}
            className="bg-[#2b6cb0] hover:bg-[#1a365d]"
            disabled={isUpdating}
          >
            {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
