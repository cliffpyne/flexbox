import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/context/auth-context';
import { AlertCircle, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Alert, AlertIcon, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── Password strength calculator ────────────────────────────────────────────
function getStrength(password: string) {
  let score = 0;
  if (password.length >= 8)            score++;
  if (password.length >= 12)           score++;
  if (/[A-Z]/.test(password))          score++;
  if (/[0-9]/.test(password))          score++;
  if (/[^A-Za-z0-9]/.test(password))  score++;

  const levels = [
    { label: 'Very weak',   color: 'bg-red-500',    width: 'w-1/5' },
    { label: 'Weak',        color: 'bg-orange-500', width: 'w-2/5' },
    { label: 'Fair',        color: 'bg-yellow-500', width: 'w-3/5' },
    { label: 'Strong',      color: 'bg-blue-500',   width: 'w-4/5' },
    { label: 'Very strong', color: 'bg-green-500',  width: 'w-full' },
  ];

  return levels[Math.max(0, score - 1)] || levels[0];
}

export function ChangePasswordPage() {
  const navigate            = useNavigate();
  const { changePassword, logout } = useAuth() as any;

  const [current,  setCurrent]  = useState('');
  const [newPass,  setNewPass]  = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showCurr, setShowCurr] = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [done,     setDone]     = useState(false);

  const strength = newPass ? getStrength(newPass) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPass !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (newPass.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPass === current) {
      setError('New password must be different from your current password.');
      return;
    }

    setLoading(true);
    try {
      await changePassword(current, newPass);
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <ShieldCheck className="size-16 text-green-500" />
        <h2 className="text-xl font-semibold">Password changed!</h2>
        <p className="text-muted-foreground text-sm">
          Redirecting you to the dashboard...
        </p>
        <LoaderCircle className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="block w-full space-y-5">
      {/* Header */}
      <div className="text-center space-y-1 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Set Your Password</h1>
        <p className="text-sm text-muted-foreground">
          This is your first login. Please set a new personal password before continuing.
        </p>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" appearance="light" onClose={() => setError(null)}>
          <AlertIcon><AlertCircle /></AlertIcon>
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {/* Current password */}
      <div className="space-y-1.5">
        <Label htmlFor="current">
          Current password
          <span className="text-muted-foreground text-xs ml-1">(the one we sent you)</span>
        </Label>
        <div className="relative">
          <Input
            id="current"
            type={showCurr ? 'text' : 'password'}
            placeholder="Temporary password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={loading}
            required
          />
          <Button
            type="button"
            variant="ghost"
            mode="icon"
            onClick={() => setShowCurr((s) => !s)}
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
          >
            {showCurr
              ? <EyeOff className="size-4 text-muted-foreground" />
              : <Eye className="size-4 text-muted-foreground" />}
          </Button>
        </div>
      </div>

      {/* New password */}
      <div className="space-y-1.5">
        <Label htmlFor="newPass">New password</Label>
        <div className="relative">
          <Input
            id="newPass"
            type={showNew ? 'text' : 'password'}
            placeholder="At least 8 characters"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            disabled={loading}
            required
            minLength={8}
          />
          <Button
            type="button"
            variant="ghost"
            mode="icon"
            onClick={() => setShowNew((s) => !s)}
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
          >
            {showNew
              ? <EyeOff className="size-4 text-muted-foreground" />
              : <Eye className="size-4 text-muted-foreground" />}
          </Button>
        </div>

        {/* Strength bar */}
        {strength && (
          <div className="space-y-1 pt-1">
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all ${strength.color} ${strength.width}`} />
            </div>
            <p className="text-xs text-muted-foreground">{strength.label}</p>
          </div>
        )}
      </div>

      {/* Confirm */}
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          type="password"
          placeholder="Repeat new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={loading}
          required
          className={confirm && confirm !== newPass ? 'border-destructive' : ''}
        />
        {confirm && confirm !== newPass && (
          <p className="text-xs text-destructive">Passwords do not match.</p>
        )}
      </div>

      {/* Submit */}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <span className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" />
            Saving...
          </span>
        ) : (
          'Set New Password'
        )}
      </Button>

      {/* Sign out link */}
      <div className="text-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground text-xs"
          onClick={logout}
        >
          Sign out
        </Button>
      </div>
    </form>
  );
}
