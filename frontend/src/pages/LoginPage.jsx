import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '../components/Feedback.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Link } from 'react-router-dom';

function LoginPage() {
  const { user, loading, login, error: sessionError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  if (loading) {
    return (
      <main className="auth-loading" aria-live="polite">
        <span className="spinner" />
        <p>Checking your session…</p>
      </main>
    );
  }
  if (user) {
    return <Navigate to="/wallet" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      navigate(location.state?.from || '/wallet', { replace: true });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">V</div>
        <p className="eyebrow">VELoop Rewards</p>
        <h1>Welcome back</h1>
        <p className="muted-copy">Sign in to view your wallet and redemption options.</p>

        <Alert>{formError || sessionError}</Alert>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
          />
          <button className="button button-primary button-wide" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          New to VELoop? <Link to="/signup">Create an account</Link>
        </p>
        <p className="login-footnote">
          Your wallet and rewards are linked to your personal account.
        </p>
      </section>
    </main>
  );
}

export default LoginPage;
