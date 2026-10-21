import { useState, type FormEvent } from 'react';
import { Card, CopyButton, Empty, ErrorBox, Field, Loading, PageHead, Progress, Switch, Table, Tabs } from '../components/ui';
import { api, type AdminUser, type ApiKey, type NewApiKey } from '../lib/api';
import { useMe } from '../lib/auth';
import { errMsg, intOrNull, money, pct, roleLabel } from '../lib/format';
import { useAsync, useTitle } from '../lib/hooks';

type Example = 'curl' | 'n8n' | 'claude' | 'python';

export default function ApiKeysPage() {
  useTitle('Cổng API');
  const { user } = useMe();
  const isAdmin = user.role === 'admin';
  const origin = window.location.origin;
  const baseUrl = origin + '/v1';

  const [showAll, setShowAll] = useState(false);
  const keys = useAsync(() => api.keys(showAll), [showAll]);
  const users = useAsync<AdminUser[]>(() => (isAdmin ? api.users() : Promise.resolve([])), [isAdmin]);
  const [created, setCreated] = useState<NewApiKey | null>(null);
  const [example, setExample] = useState<Example>('curl');

  const keyForExamples = created?.key ?? 'tl-KEY_CUA_ANH_CHI';

  const examples: Record<Example, string> = {
    curl: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${keyForExamples}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Xin chào"}]}'`,
    n8n: `Trong n8n: Credentials → New → "OpenAI"
  API Key:  ${keyForExamples}
  Base URL: ${baseUrl}

Node "OpenAI" / "AI Agent" → chọn credential trên,
Model: auto (hoặc id model, ví dụ claude-haiku)`,
    claude: `# Thêm vào ~/.bashrc hoặc ~/.zshrc rồi mở lại terminal
export ANTHROPIC_BASE_URL=${origin}
export ANTHROPIC_AUTH_TOKEN=${keyForExamples}

claude`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${keyForExamples}",
)

r = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Xin chào"}],
)
print(r.choices[0].message.content)`,
  };

  return (
    <>
      <PageHead title="Cổng API" subtitle="Một Base URL, một key nội bộ cho n8n, Claude Code, Cursor" />
      <div className="stack">
        <div className="grid2">
          <Card title="Kết nối n8n, Claude Code, Cursor">
            <div className="fld-label">Base URL</div>
            <div className="keybox">
              <div className="codebox mono">{baseUrl}</div>
              <CopyButton text={baseUrl} />
            </div>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              Key hãng AI chỉ nằm trên máy chủ. Lộ key nội bộ thì thu hồi ngay, không ảnh hưởng người khác.
            </p>
          </Card>
          <CreateKey
            isAdmin={isAdmin}
            users={users.data ?? []}
            selfId={user.id}
            onCreated={(k) => {
              setCreated(k);
              void keys.reload();
            }}
          />
        </div>

        {created && (
          <section className="card newkey" aria-live="polite">
            <h2 className="h2">Key mới: {created.name}</h2>
            <p className="warn-text" style={{ marginTop: 0 }}>
              <b>Chép và cất key này ngay.</b> Key chỉ hiện một lần, đóng lại là không xem lại được.
            </p>
            <div className="keybox">
              <div className="codebox mono">{created.key}</div>
              <CopyButton text={created.key} label="Sao chép key" />
              <button type="button" className="btn btn-ghost" onClick={() => setCreated(null)}>
                Đã lưu, đóng
              </button>
            </div>
          </section>
        )}

        <Card
          title={showAll ? 'Mọi key trong hệ thống' : 'Key của anh/chị'}
          actions={
            isAdmin ? (
              <label className="inline-switch">
                <span className="small">Xem key của mọi người</span>
                <Switch label="Xem key của mọi người" checked={showAll} onChange={setShowAll} />
              </label>
            ) : null
          }
        >
          <KeyTable keys={keys.data} loading={keys.loading} error={keys.error} showUser={showAll} onChanged={() => void keys.reload()} setKeys={keys.setData} />
        </Card>

        <Card title="Gọi thử">
          <Tabs
            label="Ví dụ gọi API"
            value={example}
            onChange={setExample}
            tabs={[
              { value: 'curl', label: 'curl' },
              { value: 'n8n', label: 'n8n' },
              { value: 'claude', label: 'Claude Code' },
              { value: 'python', label: 'Python' },
            ]}
          />
          <div className="code-wrap">
            <pre>
              <code>{examples[example]}</code>
            </pre>
            <div className="code-copy">
              <CopyButton text={examples[example]} small />
            </div>
          </div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            Model <span className="mono">auto</span>: router tự chọn model theo loại việc. Có thể gửi header{' '}
            <span className="mono">x-task: easy | vision | writing | hard</span> để chỉ định loại việc.
          </p>
        </Card>
      </div>
    </>
  );
}

function KeyTable({
  keys,
  loading,
  error,
  showUser,
  onChanged,
  setKeys,
}: {
  keys: ApiKey[] | null;
  loading: boolean;
  error: string | null;
  showUser: boolean;
  onChanged: () => void;
  setKeys: (fn: (prev: ApiKey[] | null) => ApiKey[] | null) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');

  if (loading && !keys) return <Loading />;
  if (error && !keys) return <ErrorBox>{error}</ErrorBox>;
  if (!keys || keys.length === 0) return <Empty>Chưa có key nào. Tạo key ở khung bên cạnh.</Empty>;

  const toggle = async (k: ApiKey, v: boolean) => {
    setBusy(k.id);
    setErr('');
    try {
      const r = await api.updateKey(k.id, { active: v });
      setKeys((prev) => (prev ?? []).map((x) => (x.id === k.id ? r : x)));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!window.confirm(`Thu hồi key "${k.name}" (${k.prefix})? Mọi công cụ đang dùng key này sẽ ngừng chạy ngay.`)) return;
    setBusy(k.id);
    setErr('');
    try {
      await api.revokeKey(k.id);
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ErrorBox>{err}</ErrorBox>
      <Table minWidth={760}>
        <thead>
          <tr>
            <th>Tên key</th>
            {showUser && <th>Người dùng</th>}
            <th>Hôm nay / trần ngày</th>
            <th className="num">Lượt/phút</th>
            <th>Dùng lần cuối</th>
            <th>Bật</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const p = pct(k.today_used_vnd, k.daily_limit_vnd);
            return (
              <tr key={k.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{k.name}</div>
                  <div className="small muted mono">{k.prefix}</div>
                </td>
                {showUser && <td>{k.user_name}</td>}
                <td style={{ minWidth: 160 }}>
                  <div className="small">
                    {money(k.today_used_vnd)} / {k.daily_limit_vnd ? money(k.daily_limit_vnd) : 'không trần'}
                  </div>
                  {k.daily_limit_vnd ? <Progress value={p} warn={p >= 80} label={`Mức dùng key ${k.name}`} /> : null}
                </td>
                <td className="num">{k.rpm_limit}</td>
                <td className="muted">{k.last_used_at ?? 'Chưa dùng'}</td>
                <td>
                  <Switch label={`Bật key ${k.name}`} checked={k.active} disabled={busy === k.id} onChange={(v) => void toggle(k, v)} />
                </td>
                <td className="right">
                  <button type="button" className="btn btn-ghost btn-sm danger" disabled={busy === k.id} onClick={() => void revoke(k)}>
                    Thu hồi
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}

function CreateKey({
  isAdmin,
  users,
  selfId,
  onCreated,
}: {
  isAdmin: boolean;
  users: AdminUser[];
  selfId: number;
  onCreated: (k: NewApiKey) => void;
}) {
  const [name, setName] = useState('');
  const [daily, setDaily] = useState('');
  const [rpm, setRpm] = useState('60');
  const [owner, setOwner] = useState<number>(selfId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Đặt tên key để dễ nhận ra, ví dụ "n8n-zalo".');
    const rpmN = intOrNull(rpm);
    if (rpmN !== null && (rpmN < 1 || rpmN > 600)) return setErr('Lượt mỗi phút từ 1 đến 600.');
    setBusy(true);
    setErr('');
    try {
      const k = await api.createKey({
        name: name.trim(),
        daily_limit_vnd: intOrNull(daily),
        rpm_limit: rpmN ?? 60,
        ...(isAdmin && owner !== selfId ? { user_id: owner } : {}),
      });
      onCreated(k);
      setName('');
      setDaily('');
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Tạo key mới">
      <form className="form" onSubmit={submit}>
        <Field label="Tên key">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="n8n-zalo, claude-code-laptop…" />
        </Field>
        <Field label="Trần chi tiêu mỗi ngày (đ)" hint="Để trống nếu không đặt trần. Chạm trần thì key dừng tới 0h.">
          <input className="field" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="200000" />
        </Field>
        <Field label="Tối đa lượt mỗi phút">
          <input className="field" inputMode="numeric" value={rpm} onChange={(e) => setRpm(e.target.value)} />
        </Field>
        {isAdmin && (
          <Field label="Key của tài khoản" hint="Chọn tài khoản máy cho n8n, bot để tách chi phí.">
            <select className="field" value={owner} onChange={(e) => setOwner(Number(e.target.value))}>
              <option value={selfId}>Của tôi</option>
              {users
                .filter((u) => u.id !== selfId && u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {roleLabel(u.role)}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <ErrorBox>{err}</ErrorBox>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang tạo…' : 'Tạo key'}
          </button>
        </div>
      </form>
    </Card>
  );
}
