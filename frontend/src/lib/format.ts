const moneyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** 1240000 → "1.240.000đ". Số rất nhỏ (dưới 10đ) hiện 1 chữ số thập phân. */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v > 0 && v < 10) {
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(v) + 'đ';
  }
  return moneyFmt.format(Math.round(v)) + 'đ';
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return numFmt.format(v);
}

export function pct(used: number, limit: number | null | undefined): number {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

export const APP_LABELS: Record<string, string> = {
  api: 'Cổng API',
  chat: 'Chat AI',
  inbox: 'Hộp thư',
  apps: 'Ứng dụng AI',
  studio: 'Studio',
};

export function appLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return APP_LABELS[code] ?? code;
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị',
  manager: 'Quản lý cơ sở',
  staff: 'Nhân viên',
  machine: 'Tài khoản máy (n8n, bot)',
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return '—';
  return ROLE_LABELS[role] ?? role;
}

/** Số nguyên từ ô nhập; rỗng → null. */
export function intOrNull(s: string): number | null {
  const t = s.replace(/[.\s,đ]/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function floatOrNull(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase() || '?';
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Có lỗi xảy ra, anh/chị thử lại giúp.';
}
