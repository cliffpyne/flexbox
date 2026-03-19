import { getUrl } from '@/utils/getUrl';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Form, Button, Alert, Spinner, Row, Col, InputGroup, ProgressBar } from 'react-bootstrap';
import { ShieldAlert, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const AUTH_URL = import.meta.env.VITE_AUTH_SERVICE_URL || 'https://flexboxauth-service-production.up.railway.app';

// ─── Password strength ────────────────────────────────────────────────────────
function getStrength(password: string): { score: number; label: string; variant: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score: 20, label: 'Very weak', variant: 'danger' };
  if (score === 2) return { score: 40, label: 'Weak', variant: 'warning' };
  if (score === 3) return { score: 60, label: 'Fair', variant: 'info' };
  if (score === 4) return { score: 80, label: 'Strong', variant: 'primary' };
  return { score: 100, label: 'Very strong', variant: 'success' };
}

const ChangePasswordPage = () => {
  const navigate = useNavigate();
  const { accessToken, refreshUser, logout } = useAuth();

  const [current, setCurrent] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurr, setShowCurr] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = getStrength(newPass);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
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

    setLoading(true);

    try {
      const res = await fetch(`${AUTH_URL}/auth/password/change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          current_password: current,
          new_password: newPass,
        }),
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.message || 'Password change failed');

      setDone(true);

      // Refresh user profile so must_change_password becomes false
      await refreshUser();

      setTimeout(() => navigate('/dashboard', { replace: true }), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Row className="justify-content-center align-items-center min-vh-100">
        <Col md={5} className="text-center">
          <ShieldCheck size={64} className="text-success mb-3" />
          <h4 className="fw-bold mb-2">Password changed!</h4>
          <p className="text-muted">Redirecting you to the dashboard...</p>
          <Spinner animation="border" variant="success" />
        </Col>
      </Row>
    );
  }

  return (
    <Row>
      <Col md={4} className="d-none d-md-block pe-md-0">
        <div className="h-100">
          <img
            src={getUrl('/images/others/auth-hero.webp')}
            alt="Change password"
            className="w-100 h-100 object-fit-cover"
            fetchPriority="high"
            loading="eager"
            decoding="async"
            style={{ objectPosition: 'center' }}
          />
        </div>
      </Col>

      <Col md={8} className="ps-md-0">
        <div className="px-4 py-5">
          <div className="nobleui-logo d-block mb-2">
            Flex<span>Send</span>
          </div>

          <h5 className="fw-semibold mb-1">Set your new password</h5>
          <p className="text-secondary small mb-4">
            This is your first login. You must set a new password before continuing.
          </p>

          <Form onSubmit={handleSubmit} autoComplete="off">
            {error && (
              <Alert variant="danger" className="d-flex align-items-center gap-2 py-2">
                <ShieldAlert size={18} />
                <span>{error}</span>
              </Alert>
            )}

            {/* Current password */}
            <Form.Group className="mb-3" controlId="currentPassword">
              <Form.Label>
                Current password <span className="text-muted small">(the one we sent you)</span>
              </Form.Label>
              <InputGroup>
                <Form.Control
                  type={showCurr ? 'text' : 'password'}
                  placeholder="Current password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  disabled={loading}
                  required
                />
                <Button variant="outline-secondary" type="button" tabIndex={-1} onClick={() => setShowCurr((s) => !s)}>
                  {showCurr ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </InputGroup>
            </Form.Group>

            {/* New password */}
            <Form.Group className="mb-2" controlId="newPassword">
              <Form.Label>New password</Form.Label>
              <InputGroup>
                <Form.Control
                  type={showNew ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  disabled={loading}
                  required
                  minLength={8}
                />
                <Button variant="outline-secondary" type="button" tabIndex={-1} onClick={() => setShowNew((s) => !s)}>
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </InputGroup>
            </Form.Group>

            {/* Strength bar */}
            {newPass && (
              <div className="mb-3">
                <ProgressBar
                  now={strength.score}
                  variant={strength.variant as any}
                  style={{ height: 4 }}
                  className="mb-1"
                />
                <small className={`text-${strength.variant}`}>{strength.label}</small>
              </div>
            )}

            {/* Confirm */}
            <Form.Group className="mb-4" controlId="confirmPassword">
              <Form.Label>Confirm new password</Form.Label>
              <Form.Control
                type="password"
                placeholder="Repeat new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
                required
                isInvalid={!!confirm && confirm !== newPass}
              />
              <Form.Control.Feedback type="invalid">Passwords do not match.</Form.Control.Feedback>
            </Form.Group>

            <Button type="submit" variant="primary" className="w-100" disabled={loading}>
              {loading ? (
                <>
                  <Spinner size="sm" animation="border" className="me-2" />
                  Saving...
                </>
              ) : (
                'Set New Password'
              )}
            </Button>

            <div className="mt-3 text-center">
              <Button variant="link" size="sm" className="text-muted" onClick={logout}>
                Sign out
              </Button>
            </div>
          </Form>
        </div>
      </Col>
    </Row>
  );
};

export default ChangePasswordPage;
