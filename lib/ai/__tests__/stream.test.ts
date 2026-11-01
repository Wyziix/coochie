import { createSseParser } from '@/lib/ai/sse';
import { streamCoachReply } from '@/lib/ai/stream';

jest.mock('@/lib/env', () => ({
  env: { supabaseUrl: 'https://fake.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
  isSupabaseConfigured: true,
}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  }),
}));

describe('SSE parser', () => {
  it('returns complete events, waits for the rest of a split one, skips comments', () => {
    const parse = createSseParser();
    expect(parse(`: ${' '.repeat(10)}\n\nevent: delta\ndata: {"text":"Hel`)).toEqual([]);
    expect(parse('lo"}\n\nevent: delta\ndata: {"text":" there"}\n\n')).toEqual([
      { event: 'delta', data: { text: 'Hello' } },
      { event: 'delta', data: { text: ' there' } },
    ]);
    expect(parse('event: done\r\ndata: {"messages":[]}\r\n\r\n')).toEqual([
      { event: 'done', data: { messages: [] } },
    ]);
  });
});

/** A fake XMLHttpRequest that delivers the body in chunks, like a streamed response. */
class FakeXhr {
  static last: FakeXhr;
  status = 0;
  responseText = '';
  timeout = 0;
  headers: Record<string, string> = {};
  url = '';
  body = '';
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: string) {
    this.body = body;
  }
  chunk(status: number, text: string) {
    this.status = status;
    this.responseText += text;
    this.onprogress?.();
  }
  end() {
    this.onload?.();
  }
}

beforeAll(() => {
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
});

const tick = () => new Promise((r) => setImmediate(r));
const messages = [
  { id: 'q', role: 'user', content: 'Hi', created_at: '1' },
  { id: 'a', role: 'assistant', content: 'Hello there', created_at: '2' },
];

describe('streamCoachReply', () => {
  it('shows the text as it arrives, then resolves with the saved messages', async () => {
    const seen: string[] = [];
    const reply = streamCoachReply('Hi', (t) => seen.push(t));
    await tick();
    const xhr = FakeXhr.last;
    expect(xhr.url).toBe('https://fake.supabase.co/functions/v1/coach');
    expect(xhr.headers.Authorization).toBe('Bearer jwt');
    expect(JSON.parse(xhr.body)).toEqual({ message: 'Hi' });
    xhr.chunk(200, ': padding\n\nevent: delta\ndata: {"text":"Hello"}\n\n');
    expect(seen).toEqual(['Hello']);
    xhr.chunk(200, 'event: delta\ndata: {"text":" there"}\n\n');
    expect(seen).toEqual(['Hello', 'Hello there']);
    xhr.chunk(200, `event: done\ndata: ${JSON.stringify({ messages })}\n\n`);
    await expect(reply).resolves.toEqual(messages);
  });

  it('works when the whole reply arrives at once (buffered)', async () => {
    const seen: string[] = [];
    const reply = streamCoachReply('Hi', (t) => seen.push(t));
    await tick();
    const xhr = FakeXhr.last;
    xhr.status = 200;
    xhr.responseText = `event: delta\ndata: {"text":"Hello there"}\n\nevent: done\ndata: ${JSON.stringify({ messages })}\n\n`;
    xhr.end();
    await expect(reply).resolves.toEqual(messages);
    expect(seen).toEqual(['Hello there']);
  });

  it('a refusal (limit) comes back as JSON with its message', async () => {
    const reply = streamCoachReply('Hi', () => {});
    await tick();
    const xhr = FakeXhr.last;
    xhr.chunk(
      429,
      JSON.stringify({ error: 'limit', message: 'You’ve used your 15 coach messages.' }),
    );
    xhr.end();
    await expect(reply).rejects.toMatchObject({
      code: 'limit',
      message: 'You’ve used your 15 coach messages.',
    });
  });

  it('an error event mid-stream, or a dropped connection, rejects', async () => {
    const a = streamCoachReply('Hi', () => {});
    await tick();
    FakeXhr.last.chunk(200, 'event: error\ndata: {"error":"ai_error","message":"Try again."}\n\n');
    await expect(a).rejects.toMatchObject({ code: 'ai_error', message: 'Try again.' });

    const b = streamCoachReply('Hi', () => {});
    await tick();
    FakeXhr.last.chunk(200, 'event: delta\ndata: {"text":"Hel"}\n\n');
    FakeXhr.last.end();
    await expect(b).rejects.toMatchObject({ message: /dropped/ });

    const c = streamCoachReply('Hi', () => {});
    await tick();
    FakeXhr.last.onerror?.();
    await expect(c).rejects.toThrow('Network request failed');
  });
});
