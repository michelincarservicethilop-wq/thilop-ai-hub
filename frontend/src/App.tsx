import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import AdminPage from './pages/admin/AdminPage';
import ApiKeysPage from './pages/ApiKeys';
import AppsPage from './pages/apps/AppsPage';
import ChatPage from './pages/Chat';
import InboxPage from './pages/Inbox';
import LoginPage from './pages/Login';
import OverviewPage from './pages/Overview';
import StudioPage from './pages/Studio';

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading, loggedOut } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="boot">
        <Loading text="Đang mở Thi Lốp AI Hub…" />
      </div>
    );
  if (!me) return <Navigate to="/login" replace state={loggedOut ? null : { from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { me } = useAuth();
  if (!me || !roles.includes(me.user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="apps" element={<AppsPage />} />
        <Route path="apps/:appId" element={<AppsPage />} />
        <Route path="studio" element={<StudioPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route
          path="admin"
          element={
            <RequireRole roles={['admin', 'manager']}>
              <AdminPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
