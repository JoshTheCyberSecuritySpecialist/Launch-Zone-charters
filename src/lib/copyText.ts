/** Copy text to clipboard with a mobile-friendly fallback. */
export async function copyText(text: string): Promise<'clipboard' | 'fallback'> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    } catch {
      /* try legacy fallback */
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) return 'clipboard';
  } catch {
    /* fall through */
  }

  return 'fallback';
}
