import { describe, expect, it } from 'vitest';
import { messageKey } from './thread.ts';

describe('messageKey', () => {
  // The API moves the ephemeral cache breakpoint between requests, so the same
  // logical message serializes differently turn to turn. Keying on raw JSON would
  // treat it as new and leak it into the next request's delta (and spawn spurious
  // fan-in edges). The key must ignore cache_control.
  it('treats messages differing only in cache_control as identical', () => {
    const withCache = {
      role: 'user',
      content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }],
    };
    const without = { role: 'user', content: [{ type: 'text', text: 'hi' }] };
    expect(messageKey(withCache)).toBe(messageKey(without));
  });

  it('still distinguishes genuinely different messages', () => {
    expect(messageKey({ role: 'user', content: 'a' })).not.toBe(
      messageKey({ role: 'user', content: 'b' }),
    );
  });
});
