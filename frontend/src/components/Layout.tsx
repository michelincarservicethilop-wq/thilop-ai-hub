import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useMe } from '../lib/auth';
import { errMsg, money, pct, roleLabel } from '../lib/format';
import { useInterval } from '../lib/hooks';
import { IconAdmin, IconApps, IconChat, IconInbox, IconKey, IconOverview, IconStudio } from './icons';
import { Dialog, ErrorBox, Field, Note, Progress } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  show: (role: string) => boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Tổng quan', icon: <IconOverview />, end: true, show: () => true },
  { to: '/chat', label: 'Chat AI', icon: <IconChat />, show: () => true },
  { to: '/inbox', label: 'Hộp thư khách hàng', icon: <IconInbox />, show: () => true },
  { to: '/apps', label: 'Ứng dụng AI', icon: <IconApps />, show: () => true },
  { to: '/studio', label: 'Studio nội dung', icon: <IconStudio />, show: () => true },
  { to: '/api-keys', label: 'Cổng API', icon: <IconKey />, show: () => true },
  { to: '/admin', label: 'Quản trị', icon: <IconAdmin />, show: (r) => r === 'admin' || r === 'manager' },
];

export default function Layout() {
  const me = useMe();
  const user = me.user;
  const { refresh } = useAuth();
  const location = useLocation();
  const [pwOpen, setPwOpen] = useState(false);

  // Cập nhật hạn mức khi đổi trang và mỗi phút
  useEffect(() => {
    void refresh();
  }, [location.pathname, refresh]);
  useInterval(() => void refresh(), 60_000);

  const q = me.quota;
  const used = q.month_used ?? 0;
  const p = pct(used, q.month_limit);

  return (
    <div className="app">
      <a className="skip" href="#main">
        Bỏ qua menu
      </a>
      <aside className="side">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            TL
          </div>
          <div>
            <div className="brand-name">Thi Lốp AI Hub</div>
            <div className="brand-sub">Cổng AI nội bộ</div>
          </div>
        </div>
        <nav className="navlist" aria-label="Menu chính">
          {NAV.filter((n) => n.show(user.role)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-btn' + (isActive ? ' on' : '')}>
              {n.icon}
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who-line">
            <div className="who-name">{user.name}</div>
            <div className="who-sub">
              {roleLabel(user.role)}
              {user.branch_name ? ' · ' + user.branch_name : ''}
            </div>
          </div>
          <div className="quota">
            <div className="quota-title">Hạn mức của anh/chị</div>
            <div className="quota-val">
              {money(used)} / {q.month_limit ? money(q.month_limit) : 'không giới hạn'} tháng này
            </div>
            {q.month_limit ? <Progress value={p} warn={p >= 80} dark label="Mức dùng hạn mức tháng" /> : null}
          </div>
          <div className="foot-btns">
            <button type="button" className="foot-btn" onClick={() => setPwOpen(true)}>
              Đổi mật khẩu
            </button>
            <LogoutButton />
          </div>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <button type="button" className="foot-btn" onClick={logout}>
      Đăng xuất
    </button>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      setErr('');
      setOk(false);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (newPw.length < 8) return setErr('Mật khẩu mới cần ít nhất 8 ký tự.');
    if (newPw !== newPw2) return setErr('Hai lần nhập mật khẩu mới chưa khớp.');
    setBusy(true);
    try {
      await api.changePassword(oldPw, newPw);
      setOk(true);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Đổi mật khẩu" onClose={onClose}>
      {ok ? (
        <>
          <Note>Đã đổi mật khẩu. Lần đăng nhập sau anh/chị dùng mật khẩu mới.</Note>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Đóng
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="form">
          <Field label="Mật khẩu hiện tại">
            <input className="field" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
          </Field>
          <Field label="Mật khẩu mới" hint="Ít nhất 8 ký tự">
            <input className="field" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <input className="field" type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} required />
          </Field>
          <ErrorBox>{err}</ErrorBox>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Đổi mật khẩu'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
