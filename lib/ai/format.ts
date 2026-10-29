/** "Week of Oct 19" for a Monday (YYYY-MM-DD). */
export function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00`);
  return `Week of ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
