export function registerGlobalErrorHandlers(): void {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Global] Unhandled promise rejection:', event.reason);
  });

  window.addEventListener('error', (event) => {
    console.error('[Global] Uncaught error:', event.error ?? event.message);
  });
}
