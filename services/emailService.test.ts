import { describe, it, expect } from 'vitest';
import { leaveTypeLabel } from './emailService';

const KNOWN_TYPES: Array<[string, string]> = [
  ['AL', 'Cuti Tahunan (Annual Leave)'],
  ['MC', 'Cuti Sakit / Medical Leave'],
  ['HL', 'Cuti Hospitalisasi (HL)'],
  ['ML', 'Cuti Bersalin (Maternity)'],
  ['PL', 'Cuti Isteri Bersalin (Paternity)'],
  ['EL', 'Cuti Kecemasan (Emergency)'],
  ['BL', 'Cuti Ehsan (Compassionate)'],
  ['RL', 'Cuti Ganti (Replacement)'],
  ['UL', 'Cuti Tanpa Gaji (Unpaid)'],
  ['CME', 'CME Leave'],
];

describe('leaveTypeLabel', () => {
  it.each(KNOWN_TYPES)('maps %s to "%s"', (code, label) => {
    expect(leaveTypeLabel(code)).toBe(label);
  });

  it('returns the raw code for an unknown leave type', () => {
    expect(leaveTypeLabel('XYZ')).toBe('XYZ');
  });

  it('is case-sensitive (lowercase returns raw code)', () => {
    expect(leaveTypeLabel('al')).toBe('al');
  });
});
