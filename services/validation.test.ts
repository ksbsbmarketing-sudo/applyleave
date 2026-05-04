import { describe, it, expect } from 'vitest';
import {
  validateLeaveApplication,
  validateIC,
  validateRegistration,
  type LeaveApplicationInput,
} from './validation';

const BASE: LeaveApplicationInput = {
  staffId: 'S001',
  staffName: 'Ahmad Bin Ali',
  type: 'AL',
  duration: 3,
  startDate: '2026-06-01',
  endDate: '2026-06-03',
  reason: 'Perlu berehat',
};

describe('validateLeaveApplication', () => {
  it('returns null for valid input', () => {
    expect(validateLeaveApplication(BASE)).toBeNull();
  });

  it('rejects missing staffId', () => {
    expect(validateLeaveApplication({ ...BASE, staffId: '' })).not.toBeNull();
  });

  it('rejects missing staffName', () => {
    expect(validateLeaveApplication({ ...BASE, staffName: '' })).not.toBeNull();
  });

  it('rejects missing startDate', () => {
    expect(validateLeaveApplication({ ...BASE, startDate: '' })).not.toBeNull();
  });

  it('rejects endDate before startDate', () => {
    const result = validateLeaveApplication({ ...BASE, endDate: '2026-05-01' });
    expect(result).not.toBeNull();
  });

  it('rejects duration of 0', () => {
    const result = validateLeaveApplication({ ...BASE, duration: 0 });
    expect(result).not.toBeNull();
  });

  it('rejects duration greater than 365', () => {
    const result = validateLeaveApplication({ ...BASE, duration: 366 });
    expect(result).not.toBeNull();
  });

  it('rejects reason shorter than 5 characters', () => {
    const result = validateLeaveApplication({ ...BASE, reason: 'Hi' });
    expect(result).not.toBeNull();
  });

  it('accepts reason of exactly 5 characters', () => {
    expect(validateLeaveApplication({ ...BASE, reason: 'Abcde' })).toBeNull();
  });

  it('rejects BL type without attachmentUrl', () => {
    const result = validateLeaveApplication({ ...BASE, type: 'BL' });
    expect(result).not.toBeNull();
  });

  it('accepts BL type with attachmentUrl', () => {
    const result = validateLeaveApplication({ ...BASE, type: 'BL', attachmentUrl: 'https://example.com/doc.pdf' });
    expect(result).toBeNull();
  });

  it('accepts other types without attachmentUrl', () => {
    expect(validateLeaveApplication({ ...BASE, type: 'MC' })).toBeNull();
  });
});

describe('validateIC', () => {
  it('accepts a valid 12-digit IC', () => {
    expect(validateIC('900101065069')).toBeNull();
  });

  it('rejects an 11-digit numeric IC', () => {
    expect(validateIC('90010106506')).not.toBeNull();
  });

  it('rejects a 13-digit numeric IC', () => {
    expect(validateIC('9001010650691')).not.toBeNull();
  });

  it('accepts non-numeric IC (super_admin bypass)', () => {
    expect(validateIC('super_admin')).toBeNull();
  });

  it('strips dashes before checking length', () => {
    expect(validateIC('900101-06-5069')).toBeNull();
  });

  it('rejects all zeros with wrong length', () => {
    expect(validateIC('0000000')).not.toBeNull();
  });
});

describe('validateRegistration', () => {
  it('returns null for valid inputs', () => {
    expect(validateRegistration('Ahmad Bin Ali', '900101065069', 'password123')).toBeNull();
  });

  it('rejects IC that is not 12 digits', () => {
    expect(validateRegistration('Ahmad Bin Ali', '90010106', 'password123')).not.toBeNull();
  });

  it('rejects name shorter than 3 characters', () => {
    expect(validateRegistration('Ab', '900101065069', 'password123')).not.toBeNull();
  });

  it('rejects password shorter than 8 characters', () => {
    expect(validateRegistration('Ahmad Bin Ali', '900101065069', 'pass')).not.toBeNull();
  });

  it('accepts password of exactly 8 characters', () => {
    expect(validateRegistration('Ahmad Bin Ali', '900101065069', '12345678')).toBeNull();
  });

  it('accepts name of exactly 3 characters', () => {
    expect(validateRegistration('Ali', '900101065069', 'password123')).toBeNull();
  });

  it('rejects non-numeric IC', () => {
    expect(validateRegistration('Ahmad Bin Ali', 'super_admin', 'password123')).not.toBeNull();
  });
});
