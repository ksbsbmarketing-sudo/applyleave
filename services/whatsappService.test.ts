import { describe, it, expect } from 'vitest';
import { buildWALink, leaveTypeWA } from './whatsappService';

describe('buildWALink', () => {
  it('normalizes a local number starting with 0 to country code 60', () => {
    const link = buildWALink('0123456789', 'hello');
    expect(link).toContain('60123456789');
  });

  it('leaves an already-prefixed 60 number unchanged', () => {
    const link = buildWALink('60123456789', 'hello');
    expect(link).toContain('60123456789');
  });

  it('starts with the wa.me base URL', () => {
    const link = buildWALink('60123456789', 'test');
    expect(link.startsWith('https://wa.me/')).toBe(true);
  });

  it('URL-encodes the message text', () => {
    const link = buildWALink('60123456789', 'Hello World');
    expect(link).toContain('Hello%20World');
  });

  it('strips non-digit characters from the phone number', () => {
    const link = buildWALink('+60 12-345 6789', 'hi');
    expect(link).toContain('60123456789');
    expect(link).not.toContain('+');
  });
});

describe('leaveTypeWA', () => {
  const EXPECTED_CODES = ['AL', 'MC', 'HL', 'ML', 'PL', 'EL', 'BL', 'RL', 'UL', 'CME'];

  it.each(EXPECTED_CODES)('has an entry for %s', (code) => {
    expect(leaveTypeWA).toHaveProperty(code);
    expect(typeof leaveTypeWA[code]).toBe('string');
    expect(leaveTypeWA[code].length).toBeGreaterThan(0);
  });

  it('contains exactly 10 leave type codes', () => {
    expect(Object.keys(leaveTypeWA).length).toBe(10);
  });
});
