import { getUrl } from '@/utils/getUrl';
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { Form, Button, Alert, Spinner, Row, Col, InputGroup } from 'react-bootstrap';
import { ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where to redirect after login
  const from = (location.state as any)?.from?.pathname || '/dashboard';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await login(username, password);

      if (result.must_change_password) {
        // First login — force password change
        navigate('/auth/change-password', { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  };

  return (
    <Row>
      <Col md={4} className="d-none d-md-block pe-md-0">
        <div className="h-100">
          <img
            src={getUrl('/images/others/auth-hero.webp')}
            alt="Login illustration"
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
          {/* Logo */}
          <Link to="." className="nobleui-logo d-block mb-2">
            Flex<span>Send</span>
          </Link>

          <h5 className="text-secondary fw-normal mb-4">Staff portal — sign in to your account.</h5>

          <Form onSubmit={handleSubmit} autoComplete="on">
            {error && (
              <Alert variant="danger" className="d-flex align-items-center gap-2 py-2">
                <ShieldAlert size={18} />
                <span>{error}</span>
              </Alert>
            )}

            {/* Username */}
            <Form.Group className="mb-3" controlId="loginUsername">
              <Form.Label>Username</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. FS-ADMIN"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                required
              />
            </Form.Group>

            {/* Password */}
            <Form.Group className="mb-3" controlId="loginPassword">
              <Form.Label>Password</Form.Label>
              <InputGroup>
                <Form.Control
                  type={showPass ? 'text' : 'password'}
                  placeholder="Your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <Button variant="outline-secondary" type="button" tabIndex={-1} onClick={() => setShowPass((s) => !s)}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </InputGroup>
            </Form.Group>

            {/* Forgot password */}
            <div className="d-flex mb-4 justify-content-end">
              <Link to="/auth/forgot-password" className="small">
                Forgot password?
              </Link>
            </div>

            {/* Submit */}
            <Button type="submit" variant="primary" className="w-100" disabled={loading}>
              {loading ? (
                <>
                  <Spinner size="sm" animation="border" className="me-2" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </Form>

          <p className="mt-4 text-center text-secondary small mb-0">
            This portal is for FlexSend staff only.
            <br />
            Customers and riders use the mobile app.
          </p>
        </div>
      </Col>
    </Row>
  );
};

export default LoginPage;
