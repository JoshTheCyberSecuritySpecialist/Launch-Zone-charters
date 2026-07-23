import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import FullPageLoader from '../FullPageLoader';
import CaptainAccessDenied from './CaptainAccessDenied';

type CaptainEntryGateProps = {
  children: ReactNode;
  redirectFrom?: string;
};

/** Protects captain routes: signed-in active captains only. */
export default function CaptainEntryGate({ children, redirectFrom }: CaptainEntryGateProps) {
  const { user, isCaptain, loading } = useAuth();

  if (loading) {
    return <FullPageLoader message="Checking captain access…" />;
  }

  if (!user) {
    return (
      <Navigate
        to="/captain-login"
        replace
        state={{ from: redirectFrom || '/captain' }}
      />
    );
  }

  if (!isCaptain) {
    return <CaptainAccessDenied signedIn />;
  }

  return <>{children}</>;
}
