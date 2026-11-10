import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert } from '../components/Feedback.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function SignupPage() {
  const { user, loading, register, error: sessionError } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setFormError('Name must be between 2 and 80 characters.');
      return;
    }
    if (new TextEncoder().encode(password).length < 8 || new TextEncoder().encode(password).length > 72) {
      setFormError('Password must be between 8 and 72 UTF-8 bytes.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register({ name: trimmedName, email: email.trim(), password });
      navigate('/wallet', { replace: true });
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
        <h1>Create your account</h1>
        <p className="muted-copy">Join VELoop and keep your rewards in one place.</p>

        <Alert>{formError || sessionError}</Alert>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>Full name</span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              maxLength={254}
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <PasswordField
            label="Password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            maxLength={72}
            required
            hint="Use at least 8 characters."
          />
          <PasswordField
            label="Confirm password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          <button className="button button-primary button-wide" type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
        <p className="login-footnote">
          A new account starts with a new wallet and zero balances.
        </p>
      </section>
    </main>
  );
}

export default SignupPage;
