/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Base URL for /server API (e.g. http://localhost:3001). If empty, confirmation email is skipped. */
  readonly VITE_API_URL?: string;
  /** Digits only preferred, e.g. 8035421761, formatted for display and tel: links */
  readonly VITE_CONTACT_PHONE?: string;
  readonly VITE_BUSINESS_NAME?: string;
  readonly VITE_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
