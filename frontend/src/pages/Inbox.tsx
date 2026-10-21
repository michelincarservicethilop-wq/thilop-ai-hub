import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, Note, PageHead, Pills, Switch, Tag, type TagKind } from '../components/ui';
import {
  api,
  type Branch,
  type Channel,
  type InboxConvDetail,
  type InboxSettings,
  type InboxStatus,
} from '../lib/api';
import { isManagerRole, useMe } from '../lib/auth';
import { errMsg } from '../lib/format';
import { useAsync, useInterval, useTitle } from '../lib/hooks';

const CHANNEL: Record<string, string> = { messenger: 'Messenger', zalo: 'Zalo OA' };
const STATUS_TXT: Record<InboxStatus, string> = { bot: 'Bot đang trả lời', human: 'Cần người', done: 'Đã xong' };
const STATUS_TAG: Record<InboxStatus, TagKind> = { bot: 'ok', human: 'warn', done: 'off' };

type Filter = 'all' | InboxStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'human', label: 'Cần người' },
  { value: 'bot', label: 'Bot' },
  { value: 'done', label: 'Đã xong' },
];

const RULES: { key: keyof InboxSettings['rules']; label: string }[] = [
  { key: 'complaint', label: 'Khiếu nại, phàn nàn' },
  { key: 'offprice', label: 'Hỏi hàng ngoài bảng giá, xin giảm giá' },
  { key: 'askhuman', label: 'Khách muốn gặp nhân viên' },
  { key: 'unsure', label: 'Bot không chắc câu trả lời' },
];

function shortTime(s: string | null): string {
  if (!s) return '';
  // ISO → HH:MM; chuỗi khác giữ nguyên
  const m = /T(\d{2}:\d{2})/.exec(s);
  return m ? m[1] : s;
}

const REASON_LABEL: Record<string, string> = {
  complaint: 'Khiếu nại, phàn nàn',
  offprice: 'Hỏi giá ngoài bảng, xin giảm giá',
  askhuman: 'Khách muốn gặp nhân viên',
  unsure: 'Bot không chắc câu trả lời',
  error: 'Bot gặp lỗi',
};

export default function InboxPage() {
  useTitle('Hộp thư khách hàng');
  const { user } = useMe();
  const mgr = isManagerRole(user.role);
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const openId = params.get('c') ? Number(params.get('c')) : null;

  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | ''>('');

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const list = useAsync(
    () => api.inboxList({ status: filter === 'all' ? '' : filter, q: qDebounced, branch_id: branchFilter }),
    [filter, qDebounced, branchFilter],
  );
  useInterval(() => void list.reload(), 5000);

  const branches = useAsync<Branch[]>(() => (mgr ? api.branches() : Promise.resolve([])), [mgr]);

  const open = (id: number) => {
    const next = new URLSearchParams(params);
    next.set('c', String(id));
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHead title="Hộp thư khách hàng" subtitle="Messenger và Zalo OA: bot trả lời câu thường gặp, câu khó chuyển người" />
      <div className={'grid-inbox' + (mgr ? '' : ' no-side')}>
        <Card title="Hội thoại" className="inbox-list">
          <Pills label="Lọc theo trạng thái" options={FILTERS} value={filter} onChange={setFilter} />
          <div className="inbox-filters">
            <label className="sr" htmlFor="inbox-q">
              Tìm hội thoại
            </label>
            <input
              id="inbox-q"
              className="field"
              type="search"
              placeholder="Tìm tên khách, nội dung…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {isAdmin && (branches.data ?? []).length > 0 && (
              <>
                <label className="sr" htmlFor="inbox-branch">
                  Lọc theo cơ sở
                </label>
                <select
                  id="inbox-branch"
                  className="field"
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Mọi cơ sở</option>
                  {(branches.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="conv-scroll">
            {list.loading && !list.data ? (
              <Loading />
            ) : list.error && !list.data ? (
              <ErrorBox>{list.error}</ErrorBox>
            ) : (list.data ?? []).length === 0 ? (
              <Empty>Không có hội thoại nào.</Empty>
            ) : (
              (list.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={'conv' + (c.id === openId ? ' on' : '')}
                  aria-current={c.id === openId ? 'true' : undefined}
                  onClick={() => open(c.id)}
                >
                  <span className="conv-top">
                    <b>
                      {c.unread_human && <span className="unread" aria-label="Có tin mới cần người" />}
                      {c.name}
                    </b>
                    <span className="small muted">{shortTime(c.last_message_at)}</span>
                  </span>
                  <span className="small muted conv-where">
                    {CHANNEL[c.channel] ?? c.channel}
                    {c.branch_name ? ' · ' + c.branch_name : ''}
                  </span>
                  <span className="small preview">{c.last_message ?? ''}</span>
                  <span className="conv-tag">
                    <Tag kind={STATUS_TAG[c.status]}>{STATUS_TXT[c.status]}</Tag>
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>

        <ConversationView id={openId} branches={branches.data ?? []} canChangeBranch={mgr} onChanged={() => void list.reload()} />

        {mgr && (
          <div className="stack">
            <BotSettings editable={isAdmin} branches={branches.data ?? []} />
            {isAdmin && <SimulateBox onDone={(cid) => { void list.reload(); open(cid); }} />}
          </div>
        )}
      </div>
    </>
  );
}

function ConversationView({
  id,
  branches,
  canChangeBranch,
  onChanged,
}: {
  id: number | null;
  branches: Branch[];
  canChangeBranch: boolean;
  onChanged: () => void;
}) {
  const [conv, setConv] = useState<InboxConvDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const msgsRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = async (silent: boolean) => {
    if (id === null) return;
    if (!silent) setLoading(true);
    try {
      const d = await api.inboxConv(id);
      setConv(d);
      setErr('');
    } catch (e) {
      if (!silent) setConv(null);
      setErr(errMsg(e));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    setConv(null);
    setReply('');
    lastCount.current = 0;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useInterval(() => void load(true), 5000, id !== null);

  useEffect(() => {
    const n = conv?.messages.length ?? 0;
    if (n !== lastCount.current && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
    lastCount.current = n;
  }, [conv]);

  if (id === null)
    return (
      <section className="card chat inbox-view">
        <Empty>Chọn một hội thoại bên trái để xem.</Empty>
      </section>
    );

  const act = async (name: string, fn: () => Promise<InboxConvDetail>) => {
    setBusy(name);
    setErr('');
    try {
      const d = await fn();
      if (d && typeof d === 'object' && 'messages' in d) setConv(d);
      else await load(true);
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = reply.trim();
    if (!t || id === null) return;
    setBusy('reply');
    setErr('');
    try {
      await api.inboxReply(id, t);
      setReply('');
      await load(true);
      onChanged();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !conv)
    return (
      <section className="card chat inbox-view">
        <Loading />
      </section>
    );
  if (!conv)
    return (
      <section className="card chat inbox-view">
        <ErrorBox>{err || 'Không mở được hội thoại.'}</ErrorBox>
      </section>
    );

  const st = conv.status;
  const canReply = st === 'human' && conv.window.staff_can_reply;

  return (
    <section className="card chat inbox-view" aria-label={`Hội thoại với ${conv.name}`}>
      <div className="conv-head">
        <div>
          <div style={{ fontWeight: 600 }}>
            {conv.name} · {CHANNEL[conv.channel] ?? conv.channel}
          </div>
          <div className="small muted">
            {conv.branch_name ?? 'Chưa gán cơ sở'}
            {conv.window?.note ? ' · ' + conv.window.note : ''}
          </div>
          {conv.handoff_reason && st === 'human' && <div className="small warn-text">Lý do chuyển: {REASON_LABEL[conv.handoff_reason] ?? conv.handoff_reason}</div>}
        </div>
        <div className="conv-actions">
          <Tag kind={STATUS_TAG[st]}>{STATUS_TXT[st]}</Tag>
          {st !== 'human' && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void act('takeover', () => api.inboxTakeover(conv.id))}>
              {busy === 'takeover' ? 'Đang tiếp quản…' : 'Tiếp quản'}
            </button>
          )}
          {st !== 'bot' && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void act('release', () => api.inboxRelease(conv.id))}>
              {busy === 'release' ? 'Đang trả…' : 'Trả lại cho bot'}
            </button>
          )}
          {st !== 'done' && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void act('done', () => api.inboxDone(conv.id))}>
              {busy === 'done' ? 'Đang lưu…' : 'Đã xong'}
            </button>
          )}
        </div>
      </div>
      {canChangeBranch && branches.length > 0 && (
        <div className="branch-pick">
          <label htmlFor="conv-branch" className="small muted">
            Cơ sở phụ trách
          </label>
          <select
            id="conv-branch"
            className="field"
            value={conv.branch_id ?? ''}
            disabled={!!busy}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v) void act('branch', () => api.inboxBranch(conv.id, v));
            }}
          >
            {conv.branch_id === null && <option value="">Chưa gán</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="msgs" ref={msgsRef} aria-live="polite">
        {conv.messages.length === 0 ? (
          <Empty>Chưa có tin nhắn.</Empty>
        ) : (
          conv.messages.map((m) => {
            const cls = m.sender === 'customer' ? 'mrow' : m.sender === 'bot' ? 'mrow user' : m.sender === 'staff' ? 'mrow staff' : 'mrow sys';
            const who = m.sender === 'customer' ? 'Khách' : m.sender === 'bot' ? 'Bot' : m.sender === 'staff' ? m.staff_name || 'Nhân viên' : '';
            return (
              <div key={m.id} className={cls}>
                <div className="bubble pre">{m.text}</div>
                <div className="meta">{[who, m.time].filter(Boolean).join(' · ')}</div>
              </div>
            );
          })
        )}
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      {canReply ? (
        <form className="composer" onSubmit={send}>
          <label className="sr" htmlFor="staff-input">
            Nhân viên trả lời khách
          </label>
          <input
            id="staff-input"
            className="field"
            placeholder="Nhân viên trả lời khách…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={!!busy || !reply.trim()}>
            {busy === 'reply' ? 'Đang gửi…' : 'Gửi'}
          </button>
        </form>
      ) : (
        <div className="composer small muted">
          {st === 'bot'
            ? 'Bot đang trả lời hội thoại này. Bấm Tiếp quản để nhân viên trả lời thay.'
            : st === 'done'
              ? 'Hội thoại đã xong. Khách nhắn lại thì bot tiếp tục trả lời.'
              : conv.window?.note
                ? `Không gửi được tin lúc này: ${conv.window.note}.`
                : 'Đã hết thời gian được phép nhắn cho khách trên kênh này.'}
        </div>
      )}
    </section>
  );
}

function BotSettings({ editable, branches }: { editable: boolean; branches: Branch[] }) {
  const s = useAsync(() => api.inboxSettings(), []);
  const [form, setForm] = useState<InboxSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (s.data) setForm(s.data);
  }, [s.data]);

  if (s.loading && !form)
    return (
      <Card title="Cài đặt bot">
        <Loading />
      </Card>
    );
  if (!form)
    return (
      <Card title="Cài đặt bot">
        <ErrorBox>{s.error}</ErrorBox>
      </Card>
    );

  const set = <K extends keyof InboxSettings>(k: K, v: InboxSettings[K]) => {
    setForm({ ...form, [k]: v });
    setMsg('');
  };
  const ro = !editable;

  const save = async () => {
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const r = await api.saveInboxSettings(form);
      if (r && typeof r === 'object' && 'rules' in r) setForm(r);
      setMsg('Đã lưu cài đặt bot.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card title="Cài đặt bot" actions={ro ? <Tag kind="off">Chỉ xem</Tag> : null}>
        <div className="mrow-line">
          <div>
            <div>Bot trả lời Messenger</div>
            <div className="small muted">{form.messenger_enabled ? 'Fanpage Thi Lốp' : 'Đang tắt · tin khách chờ nhân viên'}</div>
          </div>
          <Switch label="Bot trả lời Messenger" checked={form.messenger_enabled} onChange={ro ? undefined : (v) => set('messenger_enabled', v)} />
        </div>
        <div className="mrow-line">
          <div>
            <div>Bot trả lời Zalo OA</div>
            <div className="small muted">{form.zalo_enabled ? 'Zalo OA Thi Lốp' : 'Đang tắt · tin khách chờ nhân viên'}</div>
          </div>
          <Switch label="Bot trả lời Zalo OA" checked={form.zalo_enabled} onChange={ro ? undefined : (v) => set('zalo_enabled', v)} />
        </div>
        <div className="mrow-line">
          <div>
            <div>Trả lời ngoài giờ làm việc</div>
            <div className="small muted">Ca cần người để sáng hôm sau</div>
          </div>
          <Switch label="Trả lời ngoài giờ làm việc" checked={form.night_reply} onChange={ro ? undefined : (v) => set('night_reply', v)} />
        </div>
        <div className="form-row2" style={{ marginTop: 12 }}>
          <Field label="Mở cửa từ">
            <input
              className="field"
              type="time"
              value={form.business_hours?.start ?? ''}
              disabled={ro}
              onChange={(e) => set('business_hours', { ...form.business_hours, start: e.target.value })}
            />
          </Field>
          <Field label="Đến">
            <input
              className="field"
              type="time"
              value={form.business_hours?.end ?? ''}
              disabled={ro}
              onChange={(e) => set('business_hours', { ...form.business_hours, end: e.target.value })}
            />
          </Field>
        </div>
        {branches.length > 0 && (
          <Field label="Cơ sở nhận tin khi chưa rõ khách ở đâu">
            <select
              className="field"
              value={form.default_branch_id ?? ''}
              disabled={ro}
              onChange={(e) => set('default_branch_id', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Chưa chọn</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </Card>
      <Card title="Chuyển cho người khi">
        {RULES.map((r) => (
          <div className="mrow-line" key={r.key}>
            <div>{r.label}</div>
            <Switch
              label={'Chuyển người khi: ' + r.label}
              checked={!!form.rules?.[r.key]}
              onChange={ro ? undefined : (v) => set('rules', { ...form.rules, [r.key]: v })}
            />
          </div>
        ))}
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Ca chuyển người báo qua Telegram cho CSKH của đúng cơ sở.
        </p>
      </Card>
      <Card title="Lời nhắn của bot">
        <div className="form">
          <Field label="Câu chào mở đầu">
            <textarea className="field" rows={4} value={form.greeting} disabled={ro} onChange={(e) => set('greeting', e.target.value)} />
          </Field>
          <Field label="Câu báo khi chuyển cho nhân viên">
            <textarea className="field" rows={3} value={form.handoff_message} disabled={ro} onChange={(e) => set('handoff_message', e.target.value)} />
          </Field>
          <p className="small muted" style={{ margin: 0 }}>
            Messenger: bot chỉ trả lời trong 24 giờ kể từ tin cuối của khách; sau đó nhân viên trả lời tay trong 7 ngày.
          </p>
          {editable && (
            <>
              <ErrorBox>{err}</ErrorBox>
              {msg && <Note>{msg}</Note>}
              <div className="form-actions">
                <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
                </button>
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}

function replyText(r: unknown): string {
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.content === 'string') return o.content;
  }
  return JSON.stringify(r);
}

function SimulateBox({ onDone }: { onDone: (conversationId: number) => void }) {
  const [channel, setChannel] = useState<Channel>('messenger');
  const [name, setName] = useState('Khách thử');
  const [text, setText] = useState('');
  const [extId] = useState(() => 'thu-' + Math.random().toString(36).slice(2, 8));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [replies, setReplies] = useState<string[] | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr('');
    setReplies(null);
    try {
      const r = await api.inboxSimulate({ channel, external_user_id: extId, name: name.trim() || 'Khách thử', text: text.trim() });
      setReplies((r.replies ?? []).map(replyText));
      setText('');
      if (r.conversation_id) onDone(r.conversation_id);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Thử bot">
      <p className="small muted" style={{ marginTop: 0 }}>
        Gửi một tin giả như khách thật. Bot trả lời ở đây, không gửi ra fanpage hay Zalo.
      </p>
      <form className="form" onSubmit={submit}>
        <Pills
          label="Kênh"
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'messenger', label: 'Messenger' },
            { value: 'zalo', label: 'Zalo OA' },
          ]}
        />
        <Field label="Tên khách">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Tin nhắn của khách">
          <textarea className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ví dụ: Thay 4 lốp 205/55R16 hết bao nhiêu?" />
        </Field>
        <ErrorBox>{err}</ErrorBox>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? 'Bot đang trả lời…' : 'Gửi thử'}
          </button>
        </div>
      </form>
      {replies && (
        <div className="sim-replies">
          {replies.length === 0 ? (
            <p className="small muted">Bot không trả lời (có thể đã chuyển cho người).</p>
          ) : (
            replies.map((r, i) => (
              <div key={i} className="mrow user">
                <div className="bubble pre">{r}</div>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
