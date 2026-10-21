import { useState, type FormEvent } from 'react';
import { Card, CopyButton, Cost, Empty, ErrorBox, Field, Loading, MultiPills } from '../../components/ui';
import { api, type Branch } from '../../lib/api';
import { isManagerRole, useMe } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const SERVICES = ['Thay lốp', 'Cân bằng động', 'Đảo lốp', 'Bơm keo chống đinh', 'Thay ắc quy', 'Bảo dưỡng định kỳ'];

export default function QuoteApp() {
  const { user } = useMe();
  const mgr = isManagerRole(user.role);
  const branches = useAsync<Branch[]>(() => (mgr ? api.branches() : Promise.resolve([])), [mgr]);

  const [customer, setCustomer] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [tireSize, setTireSize] = useState('');
  const [services, setServices] = useState<string[]>(['Thay lốp']);
  const [notes, setNotes] = useState('');
  const [branchId, setBranchId] = useState<number | ''>(user.branch_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<{ text: string; cost_vnd: number } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!vehicle.trim()) return setErr('Anh/chị nhập dòng xe giúp em.');
    if (services.length === 0 && !notes.trim()) return setErr('Chọn ít nhất một dịch vụ hoặc ghi thêm yêu cầu.');
    setBusy(true);
    setErr('');
    try {
      setRes(
        await api.quote({
          customer: customer.trim() || undefined,
          vehicle: vehicle.trim(),
          tire_size: tireSize.trim() || undefined,
          services,
          branch_id: branchId === '' ? null : branchId,
          notes: notes.trim() || undefined,
        }),
      );
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid2">
      <Card title="Thông tin báo giá">
        <form className="form" onSubmit={submit}>
          <div className="form-row2">
            <Field label="Tên khách (không bắt buộc)">
              <input className="field" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Anh Minh" />
            </Field>
            <Field label="Xe">
              <input className="field" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Mazda 3 2020" required />
            </Field>
          </div>
          <div className="form-row2">
            <Field label="Cỡ lốp">
              <input className="field" value={tireSize} onChange={(e) => setTireSize(e.target.value)} placeholder="205/55R16" />
            </Field>
            <Field label="Cơ sở">
              {mgr ? (
                <select className="field" value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Không chọn</option>
                  {(branches.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="field" value={user.branch_name ?? 'Chưa gán cơ sở'} readOnly />
              )}
            </Field>
          </div>
          <div>
            <div className="fld-label">Dịch vụ</div>
            <MultiPills label="Dịch vụ" options={SERVICES} value={services} onChange={setServices} />
          </div>
          <Field label="Ghi chú thêm">
            <textarea
              className="field"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ví dụ: khách muốn lốp êm, đi phố là chính"
            />
          </Field>
          <ErrorBox>{err}</ErrorBox>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Đang soạn…' : 'Soạn báo giá'}
            </button>
          </div>
        </form>
      </Card>
      <Card title="Báo giá" actions={res ? <CopyButton text={res.text} small /> : null}>
        {busy ? (
          <Loading text="Đang soạn báo giá…" />
        ) : !res ? (
          <Empty>Báo giá hiện ở đây. Chỗ nào chưa có giá sẽ để dạng [GIÁ] để anh/chị điền.</Empty>
        ) : (
          <>
            <div className="script">{res.text}</div>
            <Cost v={res.cost_vnd} />
          </>
        )}
      </Card>
    </div>
  );
}
