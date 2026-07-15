import { Link } from 'react-router-dom';

type AdminAccessDeniedProps = {
  signedIn?: boolean;
  message?: string;
};

export default function AdminAccessDenied({
  signedIn = false,
  message,
}: AdminAccessDeniedProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">Access denied</h1>
        <p className="mt-2 text-slate-600">
          {message ||
            (signedIn ? 'This account is not authorized.' : 'Sign in as admin.')}
        </p>
        <Link
          to="/admin-login"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-600 px-5 py-3 font-bold text-white hover:bg-amber-700"
        >
          Admin Login
        </Link>
      </div>
    </div>
  );
}
