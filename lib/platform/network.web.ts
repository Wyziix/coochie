/** Calls back with true/false when the browser goes on/offline. */
export function subscribeOnline(onChange: (online: boolean) => void): () => void {
  const on = () => onChange(true);
  const off = () => onChange(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  onChange(navigator.onLine !== false);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}
