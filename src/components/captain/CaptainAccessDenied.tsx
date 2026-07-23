import { Link } from 'react-router-dom';

type CaptainAccessDeniedProps = {
  signedIn?: boolean;
  message?: string;
};

export default function CaptainAccessDenied({
  signedIn = false,
  message,
}: CaptainAccessDeniedProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">Access denied</h1>
        <p className="mt-2 text-slate-600">
          {message ||
            (signedIn
              ? 'This account is not authorized for the captain portal.'
              : 'Sign in with your captain account.')}
        </p>
        <Link
          to="/captain-login"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-600 px-5 py-3 font-bold text-white hover:bg-sky-700"
        >
          Captain Login
        </Link>
      </div>
    </div>
  );
}
