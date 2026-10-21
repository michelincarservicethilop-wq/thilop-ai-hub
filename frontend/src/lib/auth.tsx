import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearToken, getToken, onUnauthorized, setToken, type Me, type Role } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** true sau khi người dùng tự bấm Đăng xuất (không quay lại trang cũ khi đăng nhập lại) */
  loggedOut: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !!getToken());
  const [loggedOut, setLoggedOut] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch {
      // 401 đã được xử lý trong onUnauthorized; lỗi mạng thì giữ trạng thái cũ
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setMe(null);
      navigate('/login', { replace: true });
    });
    void refresh();
  }, [navigate, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    setToken(r.token);
    setLoggedOut(false);
    try {
      setMe(await api.me());
    } catch {
      setMe({ user: r.user, quota: { month_used: 0, month_limit: null, day_used: 0, day_limit: null } });
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setLoggedOut(true);
    setMe(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({ me, loading, loggedOut, login, logout, refresh }),
    [me, loading, loggedOut, login, logout, refresh],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth ngoài AuthProvider');
  return v;
}

/** Dùng trong các trang đã đăng nhập: chắc chắn có user. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Chưa đăng nhập');
  return me;
}

export function isManagerRole(role: Role): boolean {
  return role === 'admin' || role === 'manager';
}
