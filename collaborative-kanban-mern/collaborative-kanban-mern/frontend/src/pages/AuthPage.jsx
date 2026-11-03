import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../services/api';

const DEMO = [
  ['rahul@abc.example', 'Org Admin · ABC'],
  ['priya@abc.example', 'Tenant Admin · Hyderabad'],
  ['arjun@abc.example', 'Member · Hyderabad'],
  ['sneha@abc.example', 'Tenant Admin · Bangalore'],
  ['kiran@xyz.example', 'Member · XYZ Mumbai'],
];

export default function AuthPage({ mode }) {
  const isLogin = mode === 'login';
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isLogin && form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      if (isLogin) await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <div className="brand big">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          TeamBoard
        </div>
        <h1>One board per branch. Everyone in sync.</h1>
        <p>
          Multi-tenant Kanban for organisations with many branches — live updates, presence, and conflict-safe
          editing, with every branch's data kept strictly separate.
        </p>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <h2>{isLogin ? 'Sign in' : 'Create your account'}</h2>
        {!isLogin && (
          <label className="field">
            <span>Full name</span>
            <input value={form.name} onChange={set('name')} required minLength={2} />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={isLogin ? 1 : 8}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
        </label>
        {!isLogin && (
          <label className="field">
            <span>Confirm password</span>
            <input type="password" value={form.confirm} onChange={set('confirm')} required />
          </label>
        )}
        {error && <div className="banner banner-error">{error}</div>}
        <button className="btn wide" disabled={busy}>
          {busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Register'}
        </button>
        <p className="muted small center">
          {isLogin ? (
            <>
              New here? <Link to="/register">Create an account</Link>
            </>
          ) : (
            <>
              Already registered? <Link to="/login">Sign in</Link>
            </>
          )}
        </p>

        {isLogin && (
          <div className="demo">
            <div className="muted small">Demo accounts (password: Password@123)</div>
            {DEMO.map(([email, label]) => (
              <button
                type="button"
                key={email}
                className="demo-btn"
                onClick={() => setForm((f) => ({ ...f, email, password: 'Password@123' }))}
              >
                <span>{email}</span>
                <span className="muted small">{label}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
