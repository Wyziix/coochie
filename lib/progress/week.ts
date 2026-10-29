/** Monday 00:00 (local) of the week containing `d`, and the next Monday. */
export function weekBounds(d = new Date()): { from: Date; to: Date } {
  const offset = (d.getDay() + 6) % 7;
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return { from, to: new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7) };
}
