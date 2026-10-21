import { useState, type FormEvent } from 'react';
import { IconPlus } from '../../components/icons';
import { Card, Dialog, Empty, ErrorBox, Field, Loading, Table, Tag } from '../../components/ui';
import { api, type AdminUser, type Branch, type Role, type UserIn } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { errMsg, intOrNull, money, ROLE_LABELS, roleLabel } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const ROLES: Role[] = ['admin', 'manager', 'staff', 'machine'];

export default function UsersTab({ editable }: { editable: boolean }) {
  const list = useAsync(() => api.users(), []);
  const branches = useAsync(() => api.branches(), []);
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);

  return (
    <Card
      title="Người dùng"
      actions={
        editable ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>
            <IconPlus /> Thêm người dùng
          </button>
        ) : null
      }
    >
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorBox>{list.error}</ErrorBox>
      ) : (list.data ?? []).length === 0 ? (
        <Empty />
      ) : (
        <Table minWidth={820}>
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Vai trò</th>
              <th>Cơ sở</th>
              <th className="num">Đã dùng tháng</th>
              <th className="num">Hạn mức tháng</th>
              <th className="num">Hạn mức ngày</th>
              <th>Trạng thái</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.name}</div>
                  <div className="small muted">{u.email}</div>
                </td>
                <td>{roleLabel(u.role)}</td>
                <td>{u.branch_name ?? '—'}</td>
                <td className="num">{money(u.month_used_vnd)}</td>
                <td className="num">{u.monthly_limit_vnd ? money(u.monthly_limit_vnd) : '—'}</td>
                <td className="num">{u.daily_limit_vnd ? money(u.daily_limit_vnd) : '—'}</td>
                <td>{u.active ? <Tag kind="ok">Đang dùng</Tag> : <Tag kind="off">Đã khoá</Tag>}</td>
                {editable && (
                  <td className="right">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
                      Sửa
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        Hạn mức để trống thì chỉ tính theo hạn mức của cơ sở và công ty.
        {!editable && ' Chỉ quản trị thêm hoặc sửa được tài khoản.'}
      </p>
      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          branches={branches.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void list.reload();
          }}
        />
      )}
    </Card>
  );
}

function UserDialog({
  user,
  branches,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const me = useMe().user;
  const [f, setF] = useState({
    email: user?.email ?? '',
    name: user?.name ?? '',
    password: '',
    role: (user?.role ?? 'staff') as Role,
    branch: user?.branch_id?.toString() ?? '',
    monthly: user?.monthly_limit_vnd?.toString() ?? '',
    daily: user?.daily_limit_vnd?.toString() ?? '',
    active: user?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const isSelf = user?.id === me.id;
  const isMachine = f.role === 'machine';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.email.trim()) return setErr('Nhập tên và email.');
    if (!user && !isMachine && f.password.length < 8) return setErr('Mật khẩu cần ít nhất 8 ký tự.');
    if (f.password && f.password.length < 8) return setErr('Mật khẩu cần ít nhất 8 ký tự.');
    const body: UserIn = {
      email: f.email.trim(),
      name: f.name.trim(),
      role: f.role,
      branch_id: f.branch ? Number(f.branch) : null,
      monthly_limit_vnd: intOrNull(f.monthly),
      daily_limit_vnd: intOrNull(f.daily),
      active: f.active,
      ...(f.password ? { password: f.password } : {}),
    };
    setBusy(true);
    setErr('');
    try {
      if (user) await api.updateUser(user.id, body);
      else await api.createUser(body);
      onSaved();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={user ? `Sửa tài khoản ${user.name}` : 'Thêm người dùng'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-row2">
          <Field label="Họ tên">
            <input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Email đăng nhập">
            <input className="field" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required autoComplete="off" />
          </Field>
        </div>
        <div className="form-row2">
          <Field label="Vai trò">
            <select className="field" value={f.role} onChange={(e) => set('role', e.target.value)} disabled={isSelf}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cơ sở">
            <select className="field" value={f.branch} onChange={(e) => set('branch', e.target.value)}>
              <option value="">Không thuộc cơ sở</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-row2">
          <Field label="Hạn mức tháng (đ)" hint="Để trống: không giới hạn riêng">
            <input className="field" inputMode="numeric" value={f.monthly} onChange={(e) => set('monthly', e.target.value)} />
          </Field>
          <Field label="Hạn mức ngày (đ)" hint="Để trống: không giới hạn riêng">
            <input className="field" inputMode="numeric" value={f.daily} onChange={(e) => set('daily', e.target.value)} />
          </Field>
        </div>
        {!isMachine && (
          <Field label={user ? 'Mật khẩu mới' : 'Mật khẩu'} hint={user ? 'Để trống nếu không đổi. Ít nhất 8 ký tự.' : 'Ít nhất 8 ký tự'}>
            <input className="field" type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
        )}
        {isMachine && (
          <p className="small muted" style={{ margin: 0 }}>
            Tài khoản máy không đăng nhập web, chỉ dùng key API (tạo ở trang Cổng API).
          </p>
        )}
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} disabled={isSelf} />
          <span>Tài khoản đang dùng (bỏ chọn để khoá)</span>
        </label>
        <ErrorBox>{err}</ErrorBox>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
