/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(at: number | string | null | undefined, now = Date.now()): string {
  if (at == null) return 'never';
  const ms = now - (typeof at === 'number' ? at : Date.parse(at));
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
