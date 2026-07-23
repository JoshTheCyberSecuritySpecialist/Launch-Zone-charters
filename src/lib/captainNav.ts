/** True for /captain, /captain/*, and /captain-login */
export function isCaptainAreaPath(pathname: string): boolean {
  return (
    pathname === '/captain-login' ||
    pathname === '/captain' ||
    pathname.startsWith('/captain/')
  );
}

/** Staff portal paths hide public marketing chrome (admin + captain). */
export function isStaffPortalPath(pathname: string): boolean {
  return (
    pathname === '/admin-login' ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    isCaptainAreaPath(pathname)
  );
}
