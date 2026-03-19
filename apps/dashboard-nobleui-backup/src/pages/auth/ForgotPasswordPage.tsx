import { getUrl } from '@/utils/getUrl';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Form, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { ShieldAlert } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const MySwal = withReactContent(Swal);

const AUTH_URL = import.meta.env.VITE_AUTH_SERVICE_URL || 'https://flexboxauth-service-production.up.railway.app';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${AUTH_URL}/auth/password/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();

      // Always show success — do not reveal if phone is registered
      await MySwal.fire({
        title: 'Reset code sent!',
        text: 'If your phone number is registered, you will receive a reset code via SMS.',
        icon: 'success',
        confirmButtonText: 'Back to Login',
      });

      navigate('/auth/login', { replace: true });
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <Row>
      <Col md={4} className="pe-md-0">
        <div className="h-100">
          <img
            src={getUrl('/images/others/auth-hero.webp')}
            alt="Forgot password"
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
          <Link to="/auth/login" className="nobleui-logo d-block mb-2">
            Flex<span>Send</span>
          </Link>

          <h4 className="mb-2">Forgot your password?</h4>
          <p className="mb-4 text-secondary small">
            Enter your registered phone number and we will send you a reset code via SMS.
          </p>

          <Form onSubmit={handleSubmit} autoComplete="on">
            {error && (
              <Alert variant="danger" className="d-flex align-items-center gap-2 py-2">
                <ShieldAlert size={18} />
                <span>{error}</span>
              </Alert>
            )}

            <Form.Group className="mb-4" controlId="forgotPhone">
              <Form.Label>Phone number</Form.Label>
              <Form.Control
                type="tel"
                placeholder="+255700000000"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
                required
              />
            </Form.Group>

            <Button type="submit" variant="primary" className="me-2 mb-2 mb-md-0" disabled={loading}>
              {loading ? (
                <>
                  <Spinner size="sm" animation="border" className="me-2" />
                  Sending...
                </>
              ) : (
                'Send Reset Code'
              )}
            </Button>

            <Link to="/auth/login">
              <Button variant="link">Back to Login</Button>
            </Link>
          </Form>
        </div>
      </Col>
    </Row>
  );
};

export default ForgotPasswordPage;
