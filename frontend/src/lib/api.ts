/**
 * Client duy nhất gọi backend Thi Lốp AI Hub (theo docs/API.md).
 * - Gắn token `Authorization: Bearer ...`
 * - Lỗi HTTP → throw ApiError(detail)
 * - 401 → xoá token và quay về trang đăng nhập
 */
import { readSSE } from './sse';

// ---------------- Kiểu dữ liệu ----------------
export type Role = 'admin' | 'manager' | 'staff' | 'machine';
export type AppCode = 'api' | 'chat' | 'inbox' | 'apps' | 'studio';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  branch_id: number | null;
  branch_name: string | null;
  monthly_limit_vnd: number | null;
  daily_limit_vnd: number | null;
  active: boolean;
}

export interface Quota {
  month_used: number;
  month_limit: number | null;
  day_used: number;
  day_limit: number | null;
}

export interface Me {
  user: User;
  quota: Quota;
}

export interface Overview {
  scope: string;
  month_used_vnd: number;
  month_limit_vnd: number | null;
  calls_today: number;
  calls_by_app: Record<string, number>;
  cache_rate_today: number;
  active_users_7d: number;
  total_users: number;
  by_app: { app: string; cost_vnd: number }[];
  by_branch: { id: number; name: string; limit_vnd: number | null; used_vnd: number }[];
  recent: {
    time: string;
    user: string;
    app: string;
    feature: string;
    model: string | null;
    tokens: number;
    cost_vnd: number;
    cache_hit: boolean;
    status: string;
  }[];
  inbox: { messages_today: number; bot_replies: number; handoffs: number };
  alerts: { time: string; level: string; message: string }[];
}

export interface ModelOption {
  id: string;
  label: string;
  vision: boolean;
  note: string;
}

export interface PromptTpl {
  id: number;
  title: string;
  text: string;
}

export interface Conversation {
  id: number;
  title: string;
  model: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model_used: string | null;
  tokens: number | null;
  cost_vnd: number | null;
  time: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
}

export type StreamEvent =
  | { delta: string }
  | { done: true; message_id: number; model_used: string; task: string; tokens: number; cost_vnd: number }
  | { error: string };

// Hộp thư
export type InboxStatus = 'bot' | 'human' | 'done';
export type Channel = 'messenger' | 'zalo';

export interface InboxConv {
  id: number;
  channel: Channel;
  name: string;
  branch_id: number | null;
  branch_name: string | null;
  status: InboxStatus;
  handoff_reason: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_human: boolean;
}

export interface InboxMessage {
  id: number;
  sender: 'customer' | 'bot' | 'staff' | 'system';
  text: string;
  staff_name: string | null;
  time: string;
}

export interface InboxConvDetail {
  id: number;
  channel: Channel;
  name: string;
  branch_id: number | null;
  branch_name: string | null;
  status: InboxStatus;
  handoff_reason: string | null;
  window: { bot_can_reply: boolean; staff_can_reply: boolean; note: string };
  messages: InboxMessage[];
}

export interface InboxRules {
  complaint: boolean;
  offprice: boolean;
  askhuman: boolean;
  unsure: boolean;
}

export interface InboxSettings {
  messenger_enabled: boolean;
  zalo_enabled: boolean;
  night_reply: boolean;
  business_hours: { start: string; end: string };
  default_branch_id: number | null;
  greeting: string;
  handoff_message: string;
  rules: InboxRules;
  bot_model: string;
}

// Tài liệu & ứng dụng
export type DocStatus = 'queued' | 'indexing' | 'ready' | 'error' | string;

export interface DocumentItem {
  id: number;
  title: string;
  filename: string;
  public_kb: boolean;
  status: DocStatus;
  error: string | null;
  pages: number | null;
  chunks: number | null;
  created_at: string;
}

export interface AskResult {
  answer: string;
  sources: { document_id: number; title: string; page: number | null; excerpt: string }[];
  cost_vnd: number;
}

export interface InvoiceResult {
  fields: {
    supplier: string | null;
    invoice_no: string | null;
    date: string | null;
    total: number | string | null;
    tax: number | string | null;
  };
  items: { name: string; quantity: number | string | null; unit_price: number | string | null; amount: number | string | null }[];
  xlsx_url: string | null;
  cost_vnd: number;
}

export interface QuoteIn {
  customer?: string;
  vehicle: string;
  tire_size?: string;
  services: string[];
  branch_id?: number | null;
  notes?: string;
}

export interface JobResult {
  id?: number;
  kind?: string;
  status: 'queued' | 'running' | 'done' | 'error';
  result: {
    transcript?: string;
    summary?: string;
    decisions?: string[];
    actions?: { task: string; owner: string | null; due: string | null }[];
  } | null;
  error: string | null;
}

export interface RevenueResult {
  columns: string[];
  group_by: string | null;
  value_col: string | null;
  total: number;
  groups: { name: string; total: number; share: number }[];
  by_period: { period: string; total: number }[];
  commentary: string;
  cost_vnd: number;
}

// Studio
export interface ScriptResult {
  script: string;
  caption: string;
  hashtags: string[];
  cost_vnd: number;
}

export interface Voice {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

export interface TtsResult {
  url: string;
  chars: number;
  cached: boolean;
  cost_vnd: number;
}

// Key API
export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  user_id: number;
  user_name: string;
  daily_limit_vnd: number | null;
  rpm_limit: number;
  allowed_models: string[] | null;
  active: boolean;
  today_used_vnd: number;
  last_used_at: string | null;
  created_at: string;
}

export interface NewApiKey extends ApiKey {
  key: string;
}

// Quản trị
export interface AdminUser extends User {
  month_used_vnd: number;
}

export interface UserIn {
  email: string;
  name: string;
  password?: string;
  role: Role;
  branch_id: number | null;
  monthly_limit_vnd: number | null;
  daily_limit_vnd: number | null;
  active: boolean;
}

export interface BranchIn {
  name: string;
  address: string;
  phone: string;
  hours: string;
  keywords: string;
  monthly_limit_vnd: number | null;
  daily_limit_vnd: number | null;
  telegram_chat_id: string;
  active: boolean;
}

export interface Branch extends BranchIn {
  id: number;
  month_used_vnd: number;
  today_used_vnd: number;
}

export interface AdminModel {
  id: string;
  label: string;
  provider_model: string;
  kind: 'chat' | 'embedding' | 'stt' | string;
  vision: boolean;
  enabled: boolean;
  admin_only: boolean;
  note: string;
  price_in_vnd: number | null;
  price_out_vnd: number | null;
  price_cache_vnd: number | null;
  price_per_minute_vnd: number | null;
  fallback_id: string | null;
  sort: number;
}

export interface RouteRule {
  task: string;
  label: string;
  primary_model: string;
  fallback_model: string | null;
}

export interface SettingsValues {
  usd_vnd_rate: number;
  company_monthly_limit_vnd: number | null;
  company_daily_limit_vnd: number | null;
  store_content: boolean;
  cache_ttl_hours: number;
  web_rpm_limit: number;
  telegram_admin_chat_id: string;
  alert_levels: number[];
  inbox: InboxSettings;
  tts: { default_voice: string; price_per_1000_chars_vnd?: number };
}

export interface AdminSettings {
  values: SettingsValues;
  secrets_configured: Record<string, boolean>;
  webhooks: { messenger: string; zalo: string };
  public_base_url: string;
}

export type UsageGroup = 'branch' | 'user' | 'app' | 'model' | 'day' | 'feature';

export interface UsageReport {
  from: string;
  to: string;
  group: UsageGroup;
  rows: { name: string | null; calls: number; input_tokens: number; output_tokens: number; cost_vnd: number; cache_hits: number }[];
}

export interface LogRow {
  id: number;
  time: string;
  user: string;
  branch: string | null;
  app: string;
  feature: string;
  model_requested: string | null;
  model_used: string | null;
  task: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  units: number | null;
  cost_vnd: number;
  cache_hit: boolean;
  latency_ms: number | null;
  status: string;
  error: string | null;
  excerpt: string | null;
}

// ---------------- Token ----------------
const TOKEN_KEY = 'thilop_hub_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    // trình duyệt chặn lưu trữ — vẫn chạy trong phiên này
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // bỏ qua
  }
}

/** Thêm ?token=... cho link tải file / thẻ audio. */
export function withToken(url: string): string {
  const t = getToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

// ---------------- Lỗi & 401 ----------------
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let detail = '';
  try {
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'detail' in data) {
      const d = (data as { detail: unknown }).detail;
      if (typeof d === 'string') detail = d;
      else if (Array.isArray(d)) {
        detail = d
          .map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x)))
          .join('; ');
      }
    }
  } catch {
    // không phải JSON
  }
  if (res.status === 404 && (!detail || detail === 'Not Found')) detail = '';
  if (!detail) {
    if (res.status === 404) detail = 'Chức năng này chưa sẵn sàng trên máy chủ. Anh/chị thử lại sau.';
    else if (res.status >= 500) detail = `Máy chủ đang lỗi (${res.status}), anh/chị thử lại sau.`;
    else detail = `Yêu cầu không thành công (${res.status}).`;
  }
  return new ApiError(detail, res.status);
}

function handle401(res: Response, path: string) {
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    clearToken();
    unauthorizedHandler?.();
  }
}

type Body = unknown;

async function request<T>(method: string, path: string, body?: Body, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('Không kết nối được máy chủ. Anh/chị kiểm tra mạng rồi thử lại.', 0);
  }
  if (!res.ok) {
    handle401(res, path);
    throw await errorFrom(res);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('Máy chủ trả dữ liệu không đọc được.', res.status);
  }
}

const get = <T>(p: string, signal?: AbortSignal) => request<T>('GET', p, undefined, signal);
const post = <T>(p: string, b?: Body) => request<T>('POST', p, b ?? {});
const put = <T>(p: string, b: Body) => request<T>('PUT', p, b);
const patch = <T>(p: string, b: Body) => request<T>('PATCH', p, b);
const del = <T>(p: string) => request<T>('DELETE', p);

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

// ---------------- Các lời gọi ----------------
export const api = {
  // Đăng nhập
  login: (email: string, password: string) => post<{ token: string; user: User }>('/api/auth/login', { email, password }),
  me: () => get<Me>('/api/me'),
  changePassword: (old_password: string, new_password: string) =>
    post<{ ok: boolean }>('/api/me/password', { old_password, new_password }),

  overview: () => get<Overview>('/api/overview'),

  // Chat
  models: () => get<ModelOption[]>('/api/models'),
  prompts: (scope: 'chat' | 'studio') => get<PromptTpl[]>(`/api/prompts?scope=${scope}`),
  conversations: () => get<Conversation[]>('/api/chat/conversations'),
  createConversation: (b: { title?: string; model?: string }) => post<Conversation>('/api/chat/conversations', b),
  conversation: (id: number) => get<ConversationDetail>(`/api/chat/conversations/${id}`),
  deleteConversation: (id: number) => del<{ ok: boolean }>(`/api/chat/conversations/${id}`),

  /** Gửi tin và đọc trả lời dạng stream. Lỗi trước khi stream (402, 429...) throw ApiError. */
  async sendMessage(
    id: number,
    body: { content: string; model: string; images?: string[] },
    onEvent: (e: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const path = `/api/chat/conversations/${id}/messages`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError('Không kết nối được máy chủ. Anh/chị kiểm tra mạng rồi thử lại.', 0);
    }
    if (!res.ok) {
      handle401(res, path);
      throw await errorFrom(res);
    }
    await readSSE(res, (d) => {
      if (d && typeof d === 'object') onEvent(d as StreamEvent);
    });
  },

  // Hộp thư
  inboxList: (p: { status?: InboxStatus | ''; branch_id?: number | ''; q?: string }) =>
    get<InboxConv[]>('/api/inbox/conversations' + qs(p)),
  inboxConv: (id: number) => get<InboxConvDetail>(`/api/inbox/conversations/${id}`),
  inboxTakeover: (id: number) => post<InboxConvDetail>(`/api/inbox/conversations/${id}/takeover`),
  inboxRelease: (id: number) => post<InboxConvDetail>(`/api/inbox/conversations/${id}/release`),
  inboxDone: (id: number) => post<InboxConvDetail>(`/api/inbox/conversations/${id}/done`),
  inboxBranch: (id: number, branch_id: number) =>
    post<InboxConvDetail>(`/api/inbox/conversations/${id}/branch`, { branch_id }),
  inboxReply: (id: number, text: string) => post<InboxMessage>(`/api/inbox/conversations/${id}/reply`, { text }),
  inboxSettings: () => get<InboxSettings>('/api/inbox/settings'),
  saveInboxSettings: (s: InboxSettings) => put<InboxSettings>('/api/inbox/settings', s),
  inboxSimulate: (b: { channel: Channel; external_user_id: string; name: string; text: string }) =>
    post<{ conversation_id: number; replies: unknown[] }>('/api/inbox/simulate', b),

  // Tài liệu
  documents: () => get<DocumentItem[]>('/api/documents'),
  uploadDocument: (file: File, title: string, public_kb: boolean) => {
    const f = new FormData();
    f.append('file', file);
    f.append('title', title);
    f.append('public_kb', public_kb ? 'true' : 'false');
    return post<DocumentItem>('/api/documents', f);
  },
  updateDocument: (id: number, b: { title?: string; public_kb?: boolean }) => patch<DocumentItem>(`/api/documents/${id}`, b),
  deleteDocument: (id: number) => del<{ ok: boolean }>(`/api/documents/${id}`),

  // Ứng dụng
  ask: (question: string) => post<AskResult>('/api/apps/ask', { question }),
  invoice: (file: File) => {
    const f = new FormData();
    f.append('file', file);
    return post<InvoiceResult>('/api/apps/invoice', f);
  },
  quote: (b: QuoteIn) => post<{ text: string; cost_vnd: number }>('/api/apps/quote', b),
  meeting: (file: File) => {
    const f = new FormData();
    f.append('file', file);
    return post<{ job_id: number }>('/api/apps/meeting', f);
  },
  job: (id: number) => get<JobResult>(`/api/jobs/${id}`),
  revenue: (file: File) => {
    const f = new FormData();
    f.append('file', file);
    return post<RevenueResult>('/api/apps/revenue', f);
  },

  // Studio
  script: (b: { service: string; platform: 'tiktok' | 'fanpage' | 'zalo'; length_sec?: number; branch_id?: number | null; notes?: string }) =>
    post<ScriptResult>('/api/studio/script', b),
  voices: () => get<Voice[]>('/api/studio/voices'),
  tts: (text: string, voice: string) => post<TtsResult>('/api/studio/tts', { text, voice }),

  // Key API
  keys: (all: boolean) => get<ApiKey[]>('/api/keys' + (all ? '?all=1' : '')),
  createKey: (b: { name: string; daily_limit_vnd?: number | null; rpm_limit?: number; user_id?: number }) =>
    post<NewApiKey>('/api/keys', b),
  updateKey: (
    id: number,
    b: { name?: string; daily_limit_vnd?: number; clear_daily_limit?: boolean; rpm_limit?: number; active?: boolean },
  ) => patch<ApiKey>(`/api/keys/${id}`, b),
  revokeKey: (id: number) => del<{ ok: boolean }>(`/api/keys/${id}`),

  // Quản trị
  users: () => get<AdminUser[]>('/api/admin/users'),
  createUser: (b: UserIn) => post<User>('/api/admin/users', b),
  updateUser: (id: number, b: UserIn) => put<User>(`/api/admin/users/${id}`, b),
  branches: () => get<Branch[]>('/api/admin/branches'),
  createBranch: (b: BranchIn) => post<Branch>('/api/admin/branches', b),
  updateBranch: (id: number, b: BranchIn) => put<Branch>(`/api/admin/branches/${id}`, b),
  adminModels: () => get<AdminModel[]>('/api/admin/models'),
  saveModel: (m: AdminModel) => put<AdminModel>(`/api/admin/models/${encodeURIComponent(m.id)}`, m),
  testModel: (id: string) => post<{ ok: boolean; message: string }>(`/api/admin/models/${encodeURIComponent(id)}/test`),
  routes: () => get<RouteRule[]>('/api/admin/routes'),
  saveRoutes: (r: RouteRule[]) => put<RouteRule[]>('/api/admin/routes', r),
  settings: () => get<AdminSettings>('/api/admin/settings'),
  saveSettings: (b: Partial<SettingsValues>) => put<AdminSettings>('/api/admin/settings', b),
  usage: (group: UsageGroup, frm: string, to: string) => get<UsageReport>('/api/admin/usage' + qs({ group, frm, to })),
  logs: (p: { limit: number; offset: number; app?: string; status?: string; user_id?: number }) =>
    get<LogRow[]>('/api/admin/logs' + qs(p)),
};
