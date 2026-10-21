import { useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Loading, Note, Table } from '../../components/ui';
import { api, type RouteRule } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const TASK_NAME: Record<string, string> = {
  easy: 'Việc dễ',
  vision: 'Đọc ảnh',
  writing: 'Viết bài',
  hard: 'Việc khó',
};

export default function RouterTab() {
  const routes = useAsync(() => api.routes(), []);
  const models = useAsync(() => api.adminModels(), []);
  const [rows, setRows] = useState<RouteRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (routes.data) setRows(routes.data);
  }, [routes.data]);

  const chatModels = (models.data ?? []).filter((m) => m.kind === 'chat');
  const set = (i: number, patch: Partial<RouteRule>) => {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setMsg('');
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api.saveRoutes(rows.map((x) => ({ ...x, fallback_model: x.fallback_model || null })));
      setRows(r);
      setMsg('Đã lưu router. Lượt gọi mới dùng cài đặt này ngay.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const loading = (routes.loading && !routes.data) || (models.loading && !models.data);

  return (
    <Card title="Router khi model là Auto">
      <p className="small muted" style={{ marginTop: 0 }}>
        Khi người dùng hoặc công cụ chọn <b>Auto</b>, hệ thống đoán loại việc rồi gửi tới model chính; model chính lỗi thì chuyển sang dự phòng.
      </p>
      {loading ? (
        <Loading />
      ) : routes.error || models.error ? (
        <ErrorBox>{routes.error || models.error}</ErrorBox>
      ) : rows.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Table minWidth={760}>
            <thead>
              <tr>
                <th>Loại việc</th>
                <th>Mô tả</th>
                <th>Model chính</th>
                <th>Dự phòng khi lỗi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.task}>
                  <td className="nowrap">
                    <b>{TASK_NAME[r.task] ?? r.task}</b>
                    <div className="small muted mono">{r.task}</div>
                  </td>
                  <td>
                    <input className="field field-sm" aria-label={`Mô tả loại việc ${r.task}`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
                  </td>
                  <td>
                    <select
                      className="field field-sm"
                      aria-label={`Model chính cho ${r.task}`}
                      value={r.primary_model}
                      onChange={(e) => set(i, { primary_model: e.target.value })}
                    >
                      {!chatModels.some((m) => m.id === r.primary_model) && <option value={r.primary_model}>{r.primary_model}</option>}
                      {chatModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {m.enabled ? '' : ' (đang tắt)'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="field field-sm"
                      aria-label={`Model dự phòng cho ${r.task}`}
                      value={r.fallback_model ?? ''}
                      onChange={(e) => set(i, { fallback_model: e.target.value || null })}
                    >
                      <option value="">Không có</option>
                      {chatModels
                        .filter((m) => m.id !== r.primary_model)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                            {m.enabled ? '' : ' (đang tắt)'}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <ErrorBox>{err}</ErrorBox>
          {msg && <Note>{msg}</Note>}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Đang lưu…' : 'Lưu router'}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
