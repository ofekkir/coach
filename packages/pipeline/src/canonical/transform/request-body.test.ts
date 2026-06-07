import { describe, expect, it } from 'vitest';
import { decodeRawBody, extractRequestMessages } from './request-body.ts';

const REQ = { messages: [{ role: 'user', content: 'hello' }] };

describe('decodeRawBody', () => {
  it('parses plain JSON', () => {
    expect(decodeRawBody(JSON.stringify(REQ))).toEqual(REQ);
  });

  it('peels double-escaped JSON (JSON string containing JSON)', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify(REQ));
    expect(decodeRawBody(doubleEncoded)).toEqual(REQ);
  });

  it('strips [TRUNCATED marker before parsing', () => {
    const truncated = JSON.stringify(REQ) + '[TRUNCATED at 1000 bytes]';
    expect(decodeRawBody(truncated)).toEqual(REQ);
  });

  it('repairs truncated JSON (cut inside a string value)', () => {
    // Cut inside the "hello" value — repair closes the open string, brackets, and braces
    const full = JSON.stringify(REQ); // {"messages":[{"role":"user","content":"hello"}]}
    const cut = full.slice(0, full.indexOf('"hello"') + 3); // up to "hel
    const result = decodeRawBody(cut);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('object');
  });

  it('returns null for completely unparseable input', () => {
    expect(decodeRawBody('\x00\x01\x02')).toBeNull();
  });
});

describe('extractRequestMessages', () => {
  it('returns messages array from plain JSON (repair=false)', () => {
    const msgs = extractRequestMessages(JSON.stringify(REQ), false);
    expect(msgs).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('returns messages from double-escaped JSON when repair=true', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify(REQ));
    expect(extractRequestMessages(doubleEncoded, true)).toEqual([
      { role: 'user', content: 'hello' },
    ]);
  });

  it('returns null for double-escaped JSON when repair=false', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify(REQ));
    expect(extractRequestMessages(doubleEncoded, false)).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(extractRequestMessages('not json', false)).toBeNull();
    expect(extractRequestMessages('not json', true)).toBeNull();
  });
});
