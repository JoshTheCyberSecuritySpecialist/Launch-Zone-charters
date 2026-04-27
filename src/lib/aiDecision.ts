/** Parse Ollama text for GO vs NO-GO (reject forms checked before plain GO). */
export function parseAiGoNoGo(text: string): 'go' | 'no-go' | null {
  const t = text.trim();
  if (!t) return null;
  if (/NO-GO|NO GO|NOGO|NO\s*GO/i.test(t)) return 'no-go';
  if (/\bGO\b/i.test(t)) return 'go';
  return null;
}
