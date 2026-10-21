import { useState, type FormEvent } from 'react';
import { IconPlus } from '../../components/icons';
import { Card, Dialog, Empty, ErrorBox, Field, Loading, Progress, Table, Tag } from '../../components/ui';
import { api, type Branch, type BranchIn } from '../../lib/api';
import { errMsg, intOrNull, money, pct } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const EMPTY: BranchIn = {
  name: '',
  address: '',
  phone: '',
  hours: '',
  keywords: '',
  monthly_limit_vnd: null,
  daily_limit_vnd: null,
  telegram_chat_id: '',
  active: true,
};

export default function BranchesTab({ editable }: { editable: boolean }) {
  const list = useAsync(() => api.branches(), []);
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const month = new Date().getMonth() + 1;

  return (
    <Card
      title={`Hạn mức theo cơ sở · tháng ${month}`}
      actions={
        editable ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>
            <IconPlus /> Thêm cơ sở
          </button>
        ) : null
      }
    >
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorBox>{list.error}</ErrorBox>
      ) : (list.data ?? []).length === 0 ? (
        <Empty>Chưa có cơ sở nào.</Empty>
      ) : (
        <Table minWidth={780}>
          <thead>
            <tr>
              <th>Cơ sở</th>
              <th className="num">Đã dùng tháng</th>
              <th className="num">Hạn mức tháng</th>
              <th style={{ width: '22%' }}>Mức dùng</th>
              <th className="num">Hôm nay</th>
              <th>Trạng thái</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((b) => {
              const p = pct(b.month_used_vnd, b.monthly_limit_vnd);
              return (
                <tr key={b.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{b.name}</div>
                    {b.address && <div className="small muted">{b.address}</div>}
                  </td>
                  <td className="num">{money(b.month_used_vnd)}</td>
                  <td className="num">{b.monthly_limit_vnd ? money(b.monthly_limit_vnd) : 'Không giới hạn'}</td>
                  <td>{b.monthly_limit_vnd ? <Progress value={p} warn={p >= 80} label={`Mức dùng ${b.name}`} /> : <span className="muted small">—</span>}</td>
                  <td className="num">
                    {money(b.today_used_vnd)}
                    {b.daily_limit_vnd ? <span className="muted small"> / {money(b.daily_limit_vnd)}</span> : null}
                  </td>
                  <td>
                    {!b.active ? (
                      <Tag kind="off">Tạm tắt</Tag>
                    ) : b.monthly_limit_vnd && p >= 100 ? (
                      <Tag kind="err">Hết hạn mức</Tag>
                    ) : b.monthly_limit_vnd && p >= 80 ? (
                      <Tag kind="warn">{Math.round(p)}%</Tag>
                    ) : (
                      <Tag kind="ok">{b.monthly_limit_vnd ? Math.round(p) + '%' : 'Đang chạy'}</Tag>
                    )}
                  </td>
                  {editable && (
                    <td className="right">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(b)}>
                        Sửa
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {!editable && (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Chỉ quản trị sửa được hạn mức. Cần đổi thì anh/chị báo quản trị.
        </p>
      )}
      {editing && (
        <BranchDialog
          branch={editing === 'new' ? null : editing}
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

function BranchDialog({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => void }) {
  const init = branch ?? EMPTY;
  const [f, setF] = useState({
    name: init.name,
    address: init.address ?? '',
    phone: init.phone ?? '',
    hours: init.hours ?? '',
    keywords: init.keywords ?? '',
    monthly: init.monthly_limit_vnd?.toString() ?? '',
    daily: init.daily_limit_vnd?.toString() ?? '',
    telegram: init.telegram_chat_id ?? '',
    active: init.active,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Nhập tên cơ sở.');
    const body: BranchIn = {
      name: f.name.trim(),
      address: f.address.trim(),
      phone: f.phone.trim(),
      hours: f.hours.trim(),
      keywords: f.keywords.trim(),
      monthly_limit_vnd: intOrNull(f.monthly),
      daily_limit_vnd: intOrNull(f.daily),
      telegram_chat_id: f.telegram.trim(),
      active: f.active,
    };
    setBusy(true);
    setErr('');
    try {
      if (branch) await api.updateBranch(branch.id, body);
      else await api.createBranch(body);
      onSaved();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={branch ? `Sửa cơ sở ${branch.name}` : 'Thêm cơ sở'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-row2">
          <Field label="Tên cơ sở">
            <input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Điện thoại">
            <input className="field" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
        </div>
        <Field label="Địa chỉ">
          <input className="field" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <div className="form-row2">
          <Field label="Giờ mở cửa" hint="Bot dùng để trả lời khách, ví dụ: 7:30–18:00 tất cả các ngày">
            <input className="field" value={f.hours} onChange={(e) => set('hours', e.target.value)} />
          </Field>
          <Field label="Từ khoá nhận diện" hint="Cách nhau dấu phẩy, ví dụ: lê văn lương, lvl">
            <input className="field" value={f.keywords} onChange={(e) => set('keywords', e.target.value)} />
          </Field>
        </div>
        <div className="form-row2">
          <Field label="Hạn mức tháng (đ)" hint="Để trống: không giới hạn">
            <input className="field" inputMode="numeric" value={f.monthly} onChange={(e) => set('monthly', e.target.value)} />
          </Field>
          <Field label="Hạn mức ngày (đ)" hint="Để trống: không giới hạn">
            <input className="field" inputMode="numeric" value={f.daily} onChange={(e) => set('daily', e.target.value)} />
          </Field>
        </div>
        <Field label="Telegram chat ID của cơ sở" hint="Nhận cảnh báo hạn mức và tin khách cần người">
          <input className="field" value={f.telegram} onChange={(e) => set('telegram', e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
          <span>Cơ sở đang hoạt động</span>
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
