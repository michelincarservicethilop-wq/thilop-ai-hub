import { useState, type FormEvent } from 'react';
import { RichText } from '../../components/RichText';
import { Card, Cost, Empty, ErrorBox, Field, FilePick, Loading, Note, Switch, Table, Tag, type TagKind } from '../../components/ui';
import { api, type AskResult, type DocumentItem } from '../../lib/api';
import { isManagerRole, useMe } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import { useAsync, useInterval } from '../../lib/hooks';

export default function AskApp() {
  const { user } = useMe();
  const mgr = isManagerRole(user.role);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<AskResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setErr('');
    try {
      setRes(await api.ask(question.trim()));
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="grid2">
        <Card title="Câu hỏi">
          <form className="form" onSubmit={submit}>
            <Field label="Anh/chị muốn hỏi gì?">
              <textarea
                className="field"
                rows={5}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ví dụ: Chính sách bảo hành keo chống đinh thế nào?"
              />
            </Field>
            <ErrorBox>{err}</ErrorBox>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
                {busy ? 'Đang tìm trong tài liệu…' : 'Hỏi'}
              </button>
            </div>
          </form>
        </Card>
        <Card title="Trả lời">
          {busy ? (
            <Loading text="Đang đọc tài liệu…" />
          ) : !res ? (
            <Empty>Câu trả lời hiện ở đây sau khi hỏi.</Empty>
          ) : (
            <>
              <RichText text={res.answer} />
              {res.sources.length > 0 && (
                <>
                  <h3 className="h3">Nguồn</h3>
                  <ol className="sources">
                    {res.sources.map((s, i) => (
                      <li key={i}>
                        <b>{s.title}</b>
                        {s.page ? <span className="muted"> · trang {s.page}</span> : null}
                        {s.excerpt && <div className="small muted excerpt">{s.excerpt}</div>}
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <Cost v={res.cost_vnd} />
            </>
          )}
        </Card>
      </div>
      {mgr && <DocumentManager />}
    </div>
  );
}

const DOC_STATUS: Record<string, [string, TagKind]> = {
  queued: ['Đang chờ', 'off'],
  indexing: ['Đang đọc', 'info'],
  ready: ['Sẵn sàng', 'ok'],
  error: ['Lỗi', 'err'],
};

function DocumentManager() {
  const docs = useAsync(() => api.documents(), []);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [publicKb, setPublicKb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [rowBusy, setRowBusy] = useState<number | null>(null);

  const pending = (docs.data ?? []).some((d) => d.status === 'queued' || d.status === 'indexing');
  useInterval(() => void docs.reload(), 3000, pending);

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setErr('Anh/chị chọn file trước đã.');
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const d = await api.uploadDocument(file, title.trim() || file.name.replace(/\.[^.]+$/, ''), publicKb);
      docs.setData((prev) => [d, ...(prev ?? []).filter((x) => x.id !== d.id)]);
      setFile(null);
      setTitle('');
      setPublicKb(false);
      setMsg('Đã tải lên. Hệ thống đang đọc tài liệu, xong sẽ báo Sẵn sàng.');
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  const togglePublic = async (d: DocumentItem, v: boolean) => {
    setRowBusy(d.id);
    try {
      const r = await api.updateDocument(d.id, { public_kb: v });
      docs.setData((prev) => (prev ?? []).map((x) => (x.id === d.id ? { ...x, ...(r ?? {}), public_kb: v } : x)));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (d: DocumentItem) => {
    if (!window.confirm(`Xoá tài liệu "${d.title}"? Bot và ứng dụng sẽ không dùng tài liệu này nữa.`)) return;
    setRowBusy(d.id);
    try {
      await api.deleteDocument(d.id);
      docs.setData((prev) => (prev ?? []).filter((x) => x.id !== d.id));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <Card title="Quản lý tài liệu">
      <form className="form doc-upload" onSubmit={upload}>
        <FilePick
          accept=".pdf,.docx,.doc,.txt,.md,.xlsx,.xls,.csv"
          file={file}
          onFile={(f) => {
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
          }}
          hint="Nhận: PDF, Word, Excel, CSV, TXT"
        />
        <div className="form">
          <Field label="Tên tài liệu">
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ví dụ: Bảng giá lốp tháng 10" />
          </Field>
          <label className="check">
            <input type="checkbox" checked={publicKb} onChange={(e) => setPublicKb(e.target.checked)} />
            <span>Bot trả lời khách được dùng tài liệu này</span>
          </label>
          <ErrorBox>{err}</ErrorBox>
          {msg && <Note>{msg}</Note>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy || !file}>
              {busy ? 'Đang tải lên…' : 'Tải lên'}
            </button>
          </div>
        </div>
      </form>

      <div style={{ marginTop: 18 }}>
        {docs.loading && !docs.data ? (
          <Loading />
        ) : docs.error && !docs.data ? (
          <ErrorBox>{docs.error}</ErrorBox>
        ) : (docs.data ?? []).length === 0 ? (
          <Empty>Chưa có tài liệu nào.</Empty>
        ) : (
          <Table minWidth={680}>
            <thead>
              <tr>
                <th>Tài liệu</th>
                <th>Trạng thái</th>
                <th className="num">Trang</th>
                <th>Bot dùng cho khách</th>
                <th>Ngày tải</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(docs.data ?? []).map((d) => {
                const [txt, kind] = DOC_STATUS[d.status] ?? [d.status, 'off' as TagKind];
                return (
                  <tr key={d.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{d.title}</div>
                      <div className="small muted">{d.filename}</div>
                      {d.error && <div className="small err-text">{d.error}</div>}
                    </td>
                    <td>
                      <Tag kind={kind}>{txt}</Tag>
                    </td>
                    <td className="num">{d.pages ?? '—'}</td>
                    <td>
                      <Switch
                        label={`Bot trả lời khách được dùng: ${d.title}`}
                        checked={d.public_kb}
                        disabled={rowBusy === d.id}
                        onChange={(v) => void togglePublic(d, v)}
                      />
                    </td>
                    <td className="muted">{d.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    <td className="right">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={rowBusy === d.id} onClick={() => void remove(d)}>
                        Xoá
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}
