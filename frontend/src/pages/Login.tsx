import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBox, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { errMsg } from '../lib/format';
import { useTitle } from '../lib/hooks';

export default function LoginPage() {
  useTitle('Đăng nhập');
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from || '/';
  if (me) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <main className="login-card card">
        <div className="brand login-brand">
          <div className="logo" aria-hidden="true">
            TL
          </div>
          <div>
            <div className="brand-name dark">Thi Lốp AI Hub</div>
            <div className="small muted">Cổng AI nội bộ</div>
          </div>
        </div>
        <h1 className="h1" style={{ marginBottom: 4 }}>
          Đăng nhập
        </h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Dùng email công ty được cấp.
        </p>
        <form className="form" onSubmit={submit}>
          <Field label="Email">
            <input
              className="field"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Mật khẩu">
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <ErrorBox>{err}</ErrorBox>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Quên mật khẩu? Anh/chị báo quản trị để đặt lại.
        </p>
      </main>
    </div>
  );
}
