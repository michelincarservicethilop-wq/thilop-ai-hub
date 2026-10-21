import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconClose, IconImage, IconPlus, IconTrash } from '../components/icons';
import { RichText } from '../components/RichText';
import { Card, Empty, ErrorBox, Loading, PageHead, Pills } from '../components/ui';
import { api, type ChatMessage, type Conversation } from '../lib/api';
import { useAuth, useMe } from '../lib/auth';
import { errMsg, money, num } from '../lib/format';
import { useAsync, useTitle } from '../lib/hooks';

interface UIMsg {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  error?: string;
  streaming?: boolean;
}

const MAX_IMAGES = 4;

function metaLine(model: string | null | undefined, tokens: number | null | undefined, cost: number | null | undefined): string {
  const parts: string[] = [];
  if (model) parts.push(model);
  if (tokens !== null && tokens !== undefined) parts.push(`${num(tokens)} token`);
  if (cost !== null && cost !== undefined) parts.push(money(cost));
  return parts.join(' · ');
}

function toUI(m: ChatMessage): UIMsg {
  return {
    key: 'm' + m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    meta: m.role === 'user' ? m.time : [metaLine(m.model_used, m.tokens, m.cost_vnd), m.time].filter(Boolean).join(' · '),
  };
}

/** Đọc ảnh thành data URL; ảnh lớn thu nhỏ còn cạnh dài 1600px để gửi nhanh. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh ' + file.name));
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale >= 1 && file.size < 1.5 * 1024 * 1024) return resolve(src);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(src);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('File ' + file.name + ' không phải ảnh.'));
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export default function ChatPage() {
  useTitle('Chat AI');
  const me = useMe();
  const { refresh } = useAuth();
  const convs = useAsync(() => api.conversations(), []);
  const models = useAsync(() => api.models(), []);
  const prompts = useAsync(() => api.prompts('chat'), []);

  const [selected, setSelected] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<UIMsg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [model, setModel] = useState('auto');
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const skipLoad = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const modelList = models.data ?? [];
  const curModel = modelList.find((m) => m.id === model);
  const canAttach = model === 'auto' || !!curModel?.vision;

  useEffect(() => () => abortRef.current?.abort(), []);

  // Tải tin nhắn khi chọn hội thoại
  useEffect(() => {
    if (selected === null) {
      setMsgs([]);
      return;
    }
    if (skipLoad.current === selected) {
      skipLoad.current = null;
      return;
    }
    let alive = true;
    setLoadingMsgs(true);
    setErr('');
    api
      .conversation(selected)
      .then((d) => {
        if (!alive) return;
        setMsgs(d.messages.filter((m) => m.role !== 'system').map(toUI));
        if (d.model) setModel(d.model);
      })
      .catch((e) => alive && setErr(errMsg(e)))
      .finally(() => alive && setLoadingMsgs(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  // Cuộn xuống cuối khi có chữ mới
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // Model không còn hỗ trợ ảnh → bỏ ảnh đã chọn
  useEffect(() => {
    if (!canAttach && images.length) setImages([]);
  }, [canAttach, images.length]);

  const newConversation = () => {
    if (sending) return;
    setSelected(null);
    setMsgs([]);
    setErr('');
    setDraft('');
    setImages([]);
    inputRef.current?.focus();
  };

  const removeConversation = async (c: Conversation) => {
    if (!window.confirm(`Xoá hội thoại "${c.title}"? Không khôi phục được.`)) return;
    try {
      await api.deleteConversation(c.id);
      convs.setData((prev) => (prev ?? []).filter((x) => x.id !== c.id));
      if (selected === c.id) newConversation();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    setErr('');
    const room = MAX_IMAGES - images.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) setErr(`Mỗi tin gửi tối đa ${MAX_IMAGES} ảnh.`);
    try {
      const urls = await Promise.all(list.map(fileToDataUrl));
      setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && images.length === 0) || sending) return;
    setErr('');
    setSending(true);
    const sentImages = images;
    const now = Date.now();
    const asstKey = 'a' + now;
    setMsgs((prev) => [
      ...prev,
      { key: 'u' + now, role: 'user', content: text + (sentImages.length ? `\n[${sentImages.length} ảnh]` : '') },
      { key: asstKey, role: 'assistant', content: '', streaming: true },
    ]);
    setDraft('');
    setImages([]);

    const patchAsst = (fn: (m: UIMsg) => UIMsg) => setMsgs((prev) => prev.map((m) => (m.key === asstKey ? fn(m) : m)));

    try {
      let id = selected;
      if (id === null) {
        const c = await api.createConversation({ model });
        id = c.id;
        skipLoad.current = c.id;
        setSelected(c.id);
        convs.setData((prev) => [c, ...(prev ?? [])]);
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await api.sendMessage(
        id,
        { content: text, model, ...(sentImages.length ? { images: sentImages } : {}) },
        (ev) => {
          if ('delta' in ev) patchAsst((m) => ({ ...m, content: m.content + ev.delta }));
          else if ('done' in ev) patchAsst((m) => ({ ...m, streaming: false, meta: metaLine(ev.model_used, ev.tokens, ev.cost_vnd) }));
          else if ('error' in ev) patchAsst((m) => ({ ...m, streaming: false, error: ev.error }));
        },
        ctrl.signal,
      );
      patchAsst((m) => ({ ...m, streaming: false }));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      patchAsst((m) => ({ ...m, streaming: false, error: errMsg(e) }));
    } finally {
      abortRef.current = null;
      setSending(false);
      void convs.reload();
      void refresh();
    }
  }, [draft, images, sending, selected, model, convs, refresh]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const insertPrompt = (text: string) => {
    setDraft((d) => (d.trim() ? d.replace(/\s+$/, '') + '\n' + text : text));
    window.setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
  };

  const q = me.quota;
  const remaining = q.month_limit ? Math.max(0, q.month_limit - q.month_used) : null;

  return (
    <>
      <PageHead title="Chat AI" subtitle="Hỏi đáp với nhiều model, tính vào hạn mức của anh/chị" />
      <div className="grid-chat">
        <Card
          className="conv-card"
          title="Hội thoại"
          actions={
            <button type="button" className="btn btn-ghost btn-sm" onClick={newConversation} disabled={sending}>
              <IconPlus /> Mới
            </button>
          }
        >
          {convs.loading && !convs.data ? (
            <Loading />
          ) : convs.error ? (
            <ErrorBox>{convs.error}</ErrorBox>
          ) : (convs.data ?? []).length === 0 ? (
            <Empty>Chưa có hội thoại nào. Gõ câu hỏi để bắt đầu.</Empty>
          ) : (
            <ul className="conv-list">
              {(convs.data ?? []).map((c) => (
                <li key={c.id} className={'conv-item' + (c.id === selected ? ' on' : '')}>
                  <button
                    type="button"
                    className="conv-pick"
                    onClick={() => !sending && setSelected(c.id)}
                    aria-current={c.id === selected ? 'true' : undefined}
                    disabled={sending && c.id !== selected}
                  >
                    <span className="conv-title">{c.title}</span>
                    <span className="small muted">{c.updated_at.slice(11, 16) + ' ' + c.updated_at.slice(8, 10) + '/' + c.updated_at.slice(5, 7)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Xoá hội thoại ${c.title}`}
                    title="Xoá"
                    onClick={() => void removeConversation(c)}
                    disabled={sending}
                  >
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <section className="card chat" aria-label="Khung chat">
          <div className="chat-models">
            {models.loading && !models.data ? (
              <Loading text="Đang tải danh sách model…" />
            ) : models.error ? (
              <ErrorBox>{models.error}</ErrorBox>
            ) : (
              <Pills
                label="Chọn model"
                value={model}
                onChange={setModel}
                options={modelList.map((m) => ({ value: m.id, label: m.id === 'auto' ? 'Auto' : m.label, title: m.note }))}
              />
            )}
          </div>
          <div className="msgs" ref={listRef} aria-live="polite">
            {loadingMsgs ? (
              <Loading />
            ) : msgs.length === 0 ? (
              <div className="chat-empty">
                <p style={{ fontWeight: 600, margin: 0 }}>Bắt đầu hỏi đi ạ</p>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  Gõ câu hỏi bên dưới hoặc chọn một câu lệnh mẫu. Chọn Auto để hệ thống tự chọn model hợp với việc.
                </p>
              </div>
            ) : (
              msgs.map((m) => (
                <div key={m.key} className={'mrow ' + (m.role === 'user' ? 'user' : 'ai')}>
                  <div className="bubble">
                    {m.role === 'user' ? (
                      <span className="pre">{m.content}</span>
                    ) : m.content ? (
                      <RichText text={m.content} />
                    ) : m.streaming ? (
                      <span className="typing" aria-label="Đang trả lời">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : null}
                    {m.error && <div className="bubble-err">{m.error}</div>}
                  </div>
                  {m.meta && <div className="meta">{m.meta}</div>}
                </div>
              ))
            )}
          </div>
          {err && <ErrorBox>{err}</ErrorBox>}
          {images.length > 0 && (
            <div className="thumbs">
              {images.map((src, i) => (
                <div className="thumb-img" key={i}>
                  <img src={src} alt={`Ảnh đính kèm ${i + 1}`} />
                  <button
                    type="button"
                    className="thumb-x"
                    aria-label={`Bỏ ảnh ${i + 1}`}
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <IconClose />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="composer">
            {canAttach && (
              <label className={'btn btn-ghost icon-only' + (images.length >= MAX_IMAGES || sending ? ' disabled' : '')} title="Đính kèm ảnh (tối đa 4)">
                <IconImage />
                <span className="sr">Đính kèm ảnh</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr"
                  disabled={images.length >= MAX_IMAGES || sending}
                  onChange={(e) => {
                    void addImages(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            <label className="sr" htmlFor="chat-input">
              Nhập câu hỏi
            </label>
            <textarea
              id="chat-input"
              ref={inputRef}
              className="field composer-input"
              rows={1}
              placeholder="Nhập câu hỏi…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={sending || (!draft.trim() && !images.length)}>
              {sending ? 'Đang trả lời…' : 'Gửi'}
            </button>
          </div>
          <div className="small muted composer-hint">Enter để gửi, Shift + Enter để xuống dòng.</div>
        </section>

        <div className="stack chat-side">
          <Card title="Câu lệnh mẫu Thi Lốp">
            {prompts.loading && !prompts.data ? (
              <Loading />
            ) : prompts.error ? (
              <ErrorBox>{prompts.error}</ErrorBox>
            ) : (prompts.data ?? []).length === 0 ? (
              <Empty />
            ) : (
              (prompts.data ?? []).map((p) => (
                <button key={p.id} type="button" className="chip" onClick={() => insertPrompt(p.text)} title={p.text}>
                  {p.title}
                </button>
              ))
            )}
          </Card>
          <Card title="Lượt này">
            <div className="mrow-line">
              <span className="muted">Model</span>
              <span>{model === 'auto' ? 'Auto (router chọn)' : curModel?.label ?? model}</span>
            </div>
            <div className="mrow-line">
              <span className="muted">Đọc được ảnh</span>
              <span>{canAttach ? 'Có' : 'Không'}</span>
            </div>
            <div className="mrow-line" style={{ borderBottom: 0 }}>
              <span className="muted">Hạn mức tháng còn lại</span>
              <span>{remaining === null ? 'Không giới hạn' : money(remaining)}</span>
            </div>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              {curModel?.note || 'Chọn Auto để router tự đưa việc dễ sang model rẻ, việc khó sang model mạnh.'}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
