export interface LeaveApplicationInput {
  staffId: string;
  staffName: string;
  type: string;
  duration: number;
  startDate: string;
  endDate: string;
  reason: string;
  attachmentUrl?: string;
}

export function validateLeaveApplication(input: LeaveApplicationInput): string | null {
  if (!input.staffId || !input.staffName) return 'Maklumat pekerja tidak lengkap.';
  if (!input.startDate || !input.endDate) return 'Tarikh mula dan tamat diperlukan.';

  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'Format tarikh tidak sah.';
  if (end < start) return 'Tarikh tamat tidak boleh lebih awal dari tarikh mula.';

  if (!Number.isFinite(input.duration) || input.duration <= 0) return 'Tempoh cuti mesti lebih dari 0 hari.';
  if (input.duration > 365) return 'Tempoh cuti tidak boleh melebihi 365 hari.';

  if ((input.reason?.trim() ?? '').length < 5) return 'Sila berikan sebab yang lebih terperinci (sekurang-kurangnya 5 aksara).';

  if (input.type === 'BL' && !input.attachmentUrl) return 'Sila muat naik surat kematian sebagai bukti untuk Cuti Ehsan.';

  return null;
}

// IC: if all digits, must be exactly 12 (non-numeric ICs like super_admin are allowed through)
export function validateIC(ic: string): string | null {
  const sanitized = ic.replace(/-/g, '').trim();
  if (/^\d+$/.test(sanitized) && sanitized.length !== 12) {
    return 'Nombor IC mesti terdiri daripada 12 digit.';
  }
  return null;
}

export function validateRegistration(name: string, ic: string, password: string): string | null {
  const sanitized = ic.replace(/-/g, '').trim();
  if (!/^\d{12}$/.test(sanitized)) return 'Nombor IC mesti terdiri daripada 12 digit sahaja (tanpa sempang).';
  if (name.trim().length < 3) return 'Sila masukkan nama penuh yang sah.';
  if (password.length < 8) return 'Kata laluan mesti sekurang-kurangnya 8 aksara.';
  return null;
}
