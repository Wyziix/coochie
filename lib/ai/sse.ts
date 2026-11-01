/** One Server-Sent Event: `event: <name>` and a JSON `data:` line. */
export type SseEvent = { event: string; data: unknown };

/**
 * Feeds text as it arrives and returns the complete events so far. Partial
 * events wait for more text; comments (lines starting with ":") are skipped.
 */
export function createSseParser() {
  let buffer = '';
  return (chunk: string): SseEvent[] => {
    buffer += chunk.replace(/\r\n/g, '\n');
    const out: SseEvent[] = [];
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      try {
        out.push({ event, data: JSON.parse(data.join('\n')) });
      } catch {
        // not JSON: ignore
      }
    }
    return out;
  };
}
