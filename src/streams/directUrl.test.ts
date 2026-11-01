import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeXhr {
  static final = '';
  readyState = 0;
  status = 0;
  responseURL = '';
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  aborted = false;
  open() {}
  abort() {
    this.aborted = true;
  }
  send() {
    setTimeout(() => {
      this.readyState = 2;
      this.status = 206;
      this.responseURL = FakeXhr.final;
      if (this.onreadystatechange) this.onreadystatechange();
    }, 0);
  }
}

describe('endereço final da fonte', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('segue os redirecionamentos uma vez e o vídeo usa o endereço final', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('window', { location: { protocol: 'file:' }, setTimeout, clearTimeout });
    const { directFor, forgetDirect, resolveDirect } = await import('./directUrl');
    FakeXhr.final = 'http://cdn.example/t/123/file.mp4';
    const link = 'https://fonte.example/movie/v1.abc';
    expect(directFor(link)).toBe(link);
    expect(await resolveDirect(link)).toBe(FakeXhr.final);
    expect(directFor(link)).toBe(FakeXhr.final);
    forgetDirect(link);
    expect(directFor(link)).toBe(link);
  });

  it('torrent do motor e HLS ficam como estão', async () => {
    const { resolveDirect } = await import('./directUrl');
    expect(await resolveDirect('http://127.0.0.1:2710/abc/0')).toBe('http://127.0.0.1:2710/abc/0');
    expect(await resolveDirect('https://x.example/a.m3u8', true)).toBe('https://x.example/a.m3u8');
  });
});
