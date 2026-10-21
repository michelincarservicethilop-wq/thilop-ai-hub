import { useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Loading, Switch, Table, Tag } from '../../components/ui';
import { api, type AdminModel } from '../../lib/api';
import { errMsg, floatOrNull } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

type PriceKey = 'price_in_vnd' | 'price_out_vnd' | 'price_cache_vnd' | 'price_per_minute_vnd';
type Draft = Record<PriceKey, string> & { fallback_id: string };

const KIND: Record<string, string> = { chat: 'Chat', embedding: 'Nhúng (tìm tài liệu)', stt: 'Giọng nói → chữ' };

function toDraft(m: AdminModel): Draft {
  const s = (v: number | null) => (v === null || v === undefined ? '' : String(v));
  return {
    price_in_vnd: s(m.price_in_vnd),
    price_out_vnd: s(m.price_out_vnd),
    price_cache_vnd: s(m.price_cache_vnd),
    price_per_minute_vnd: s(m.price_per_minute_vnd),
    fallback_id: m.fallback_id ?? '',
  };
}

function isDirty(m: AdminModel, d: Draft): boolean {
  const o = toDraft(m);
  return (Object.keys(o) as (keyof Draft)[]).some((k) => o[k] !== d[k]);
}

export default function ModelsTab() {
  const list = useAsync(() => api.adminModels(), []);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string } | 'running'>>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    if (list.data) setDrafts(Object.fromEntries(list.data.map((m) => [m.id, toDraft(m)])));
  }, [list.data]);

  const models = list.data ?? [];

  const save = async (m: AdminModel, patch: Partial<AdminModel>) => {
    setBusy(m.id);
    setErr('');
    try {
      const r = await api.saveModel({ ...m, ...patch });
      list.setData((prev) => (prev ?? []).map((x) => (x.id === m.id ? r : x)));
    } catch (e) {
      setErr(`${m.label}: ${errMsg(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = (m: AdminModel) => {
    const d = drafts[m.id];
    if (!d) return;
    void save(m, {
      price_in_vnd: floatOrNull(d.price_in_vnd),
      price_out_vnd: floatOrNull(d.price_out_vnd),
      price_cache_vnd: floatOrNull(d.price_cache_vnd),
      price_per_minute_vnd: floatOrNull(d.price_per_minute_vnd),
      fallback_id: d.fallback_id || null,
    });
  };

  const test = async (m: AdminModel) => {
    setTests((t) => ({ ...t, [m.id]: 'running' }));
    try {
      const r = await api.testModel(m.id);
      setTests((t) => ({ ...t, [m.id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [m.id]: { ok: false, message: errMsg(e) } }));
    }
  };

  const setD = (id: string, k: keyof Draft, v: string) => setDrafts((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));

  const priceInput = (m: AdminModel, k: PriceKey, label: string) => (
    <input
      className="field field-sm num"
      inputMode="decimal"
      aria-label={`${label} của ${m.label}`}
      value={drafts[m.id]?.[k] ?? ''}
      onChange={(e) => setD(m.id, k, e.target.value)}
      placeholder="—"
    />
  );

  return (
    <Card title="Model AI">
      <p className="small muted" style={{ marginTop: 0 }}>
        Giá tính bằng đồng cho 1 triệu token (model giọng nói: đồng mỗi phút). Bật/tắt có hiệu lực ngay; sửa giá hoặc dự phòng thì bấm Lưu.
      </p>
      <ErrorBox>{err}</ErrorBox>
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error && !list.data ? (
        <ErrorBox>{list.error}</ErrorBox>
      ) : models.length === 0 ? (
        <Empty />
      ) : (
        <Table minWidth={940}>
          <thead>
            <tr>
              <th>Model</th>
              <th>Bật</th>
              <th>Chỉ admin</th>
              <th className="num">Giá vào</th>
              <th className="num">Giá ra</th>
              <th className="num">Giá cache</th>
              <th>Dự phòng khi lỗi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const d = drafts[m.id];
              const dirty = d ? isDirty(m, d) : false;
              const t = tests[m.id];
              const fallbacks = models.filter((x) => x.id !== m.id && x.kind === m.kind);
              return (
                <tr key={m.id} className={m.enabled ? '' : 'row-off'}>
                  <td className="model-cell">
                    <div style={{ fontWeight: 600 }}>{m.label}</div>
                    <div className="small muted mono">{m.provider_model}</div>
                    <div className="model-tags">
                      <Tag kind="off">{KIND[m.kind] ?? m.kind}</Tag>
                      {m.vision && <Tag kind="info">Đọc ảnh</Tag>}
                    </div>
                    {t && (
                      <div className={'small ' + (t === 'running' ? 'muted' : t.ok ? 'ok-text' : 'err-text')} aria-live="polite">
                        {t === 'running' ? 'Đang kiểm tra…' : t.message}
                      </div>
                    )}
                  </td>
                  <td>
                    <Switch label={`Bật ${m.label}`} checked={m.enabled} disabled={busy === m.id} onChange={(v) => void save(m, { enabled: v })} />
                  </td>
                  <td>
                    <Switch
                      label={`Chỉ admin chọn ${m.label}`}
                      checked={m.admin_only}
                      disabled={busy === m.id}
                      onChange={(v) => void save(m, { admin_only: v })}
                    />
                  </td>
                  {m.kind === 'stt' ? (
                    <>
                      <td colSpan={3}>
                        <div className="inline-field">
                          {priceInput(m, 'price_per_minute_vnd', 'Giá mỗi phút')}
                          <span className="small muted">đ/phút</span>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{priceInput(m, 'price_in_vnd', 'Giá vào')}</td>
                      <td>{priceInput(m, 'price_out_vnd', 'Giá ra')}</td>
                      <td>{priceInput(m, 'price_cache_vnd', 'Giá cache')}</td>
                    </>
                  )}
                  <td>
                    <select
                      className="field field-sm fallback-select"
                      aria-label={`Model dự phòng của ${m.label}`}
                      value={d?.fallback_id ?? ''}
                      onChange={(e) => setD(m.id, 'fallback_id', e.target.value)}
                    >
                      <option value="">Không có</option>
                      {fallbacks.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="btn-pair">
                      <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy === m.id} onClick={() => saveDraft(m)}>
                        {busy === m.id ? 'Đang lưu…' : 'Lưu'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={t === 'running'} onClick={() => void test(m)}>
                        Kiểm tra
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
