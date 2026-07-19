import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import FullPageLoader from '../FullPageLoader';
import AdminAccessDenied from './AdminAccessDenied';
import AdminOperationsDashboard from '../../pages/AdminOperationsDashboard';

/** `/admin` entry: signed-in admins see the dashboard; others go to login or access denied. */
export default function AdminEntryGate() {
  const { user, isAdmin, loading } = useAuth();

  if (loading) {
    return <FullPageLoader message="Checking admin access…" />;
  }

  if (!user) {
    return <Navigate to="/admin-login" replace state={{ from: '/admin' }} />;
  }

  if (!isAdmin) {
    return <AdminAccessDenied signedIn />;
  }

  return <AdminOperationsDashboard />;
}
