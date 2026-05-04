/**
 * Email Notification Service — Klinik Syed Badaruddin
 * Uses EmailJS (https://www.emailjs.com) — free, client-side, no backend needed.
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://www.emailjs.com and create a free account
 * 2. Add an Email Service (Gmail recommended) → copy the SERVICE_ID
 * 3. Create 3 Email Templates (see template structure below) → copy TEMPLATE IDs
 * 4. Go to Account → Public Key → copy PUBLIC_KEY
 * 5. Add these to your .env.local file (see .env.example)
 *
 * EMAIL TEMPLATES TO CREATE IN EMAILJS DASHBOARD:
 *
 * Template 1: ID "leave_to_hod" (New Application → HOD)
 *   Subject: "Permohonan Cuti Baharu — {{applicant_name}}"
 *   Variables: to_email, to_name, applicant_name, leave_type, duration, start_date, end_date, reason, branch, system_url
 *
 * Template 2: ID "leave_to_admin" (HOD Approved → Admin)
 *   Subject: "Cuti Menunggu Kelulusan Admin — {{applicant_name}}"
 *   Variables: to_email, to_name, applicant_name, leave_type, duration, start_date, end_date, hod_name, branch, system_url
 *
 * Template 3: ID "leave_to_applicant" (Final result → Staff)
 *   Subject: "Status Permohonan Cuti Anda — {{status_label}}"
 *   Variables: to_email, to_name, leave_type, duration, start_date, end_date, status_label, approved_by, rejection_reason, system_url
 */

const EMAILJS_PUBLIC_KEY    = import.meta.env.VITE_EMAILJS_PUBLIC_KEY ?? '';
const EMAILJS_SERVICE_ID    = import.meta.env.VITE_EMAILJS_SERVICE_ID ?? '';
const EMAILJS_TEMPLATE_HOD  = import.meta.env.VITE_EMAILJS_TEMPLATE_HOD   ?? 'leave_to_hod';
const EMAILJS_TEMPLATE_ADMIN = import.meta.env.VITE_EMAILJS_TEMPLATE_ADMIN ?? 'leave_to_admin';
const EMAILJS_TEMPLATE_STAFF = import.meta.env.VITE_EMAILJS_TEMPLATE_STAFF ?? 'leave_to_applicant';
const SYSTEM_URL             = import.meta.env.VITE_SYSTEM_URL ?? 'https://ksbsb-leave-tracker.web.app';

const isConfigured = Boolean(EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID);

const EMAILJS_API = 'https://api.emailjs.com/api/v1.0/email/send';

async function sendEmail(templateId: string, params: Record<string, string>): Promise<void> {
  if (!isConfigured) {
    console.warn('[EmailService] EmailJS not configured — set VITE_EMAILJS_PUBLIC_KEY and VITE_EMAILJS_SERVICE_ID in .env.local');
    return;
  }
  try {
    const res = await fetch(EMAILJS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: templateId,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: params,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[EmailService] Failed:', res.status, text);
    }
  } catch (err) {
    console.error('[EmailService] Network error:', err);
  }
}

// ── Leave type label helper ───────────────────────────────────────────────────
export function leaveTypeLabel(type: string): string {
  const map: Record<string, string> = {
    AL: 'Cuti Tahunan (Annual Leave)',
    MC: 'Cuti Sakit / Medical Leave',
    HL: 'Cuti Hospitalisasi (HL)',
    ML: 'Cuti Bersalin (Maternity)',
    PL: 'Cuti Isteri Bersalin (Paternity)',
    EL: 'Cuti Kecemasan (Emergency)',
    BL: 'Cuti Ehsan (Compassionate)',
    RL: 'Cuti Ganti (Replacement)',
    UL: 'Cuti Tanpa Gaji (Unpaid)',
    CME: 'CME Leave',
  };
  return map[type] ?? type;
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ── 1. Notify HOD: New leave application received ────────────────────────────
export async function notifyHOD(params: {
  hodEmail: string;
  hodName: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  reason: string;
  branch: string;
}): Promise<void> {
  await sendEmail(EMAILJS_TEMPLATE_HOD, {
    to_email: params.hodEmail,
    to_name: params.hodName,
    applicant_name: params.applicantName,
    leave_type: leaveTypeLabel(params.leaveType),
    duration: `${params.duration} hari`,
    start_date: fmtDate(params.startDate),
    end_date: fmtDate(params.endDate),
    reason: params.reason,
    branch: params.branch,
    system_url: SYSTEM_URL,
  });
}

// ── 2. Notify Admin: HOD has approved, waiting for Admin ─────────────────────
export async function notifyAdmin(params: {
  adminEmail: string;
  adminName: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  hodName: string;
  branch: string;
}): Promise<void> {
  await sendEmail(EMAILJS_TEMPLATE_ADMIN, {
    to_email: params.adminEmail,
    to_name: params.adminName,
    applicant_name: params.applicantName,
    leave_type: leaveTypeLabel(params.leaveType),
    duration: `${params.duration} hari`,
    start_date: fmtDate(params.startDate),
    end_date: fmtDate(params.endDate),
    hod_name: params.hodName,
    branch: params.branch,
    system_url: SYSTEM_URL,
  });
}

// ── 3. Notify Applicant: Final result (approved or rejected) ─────────────────
export async function notifyApplicant(params: {
  applicantEmail: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  status: 'approved' | 'rejected';
  approvedBy: string;
  rejectionReason?: string;
}): Promise<void> {
  const statusLabel = params.status === 'approved'
    ? 'DILULUSKAN (Approved)'
    : 'DITOLAK (Rejected)';

  await sendEmail(EMAILJS_TEMPLATE_STAFF, {
    to_email: params.applicantEmail,
    to_name: params.applicantName,
    leave_type: leaveTypeLabel(params.leaveType),
    duration: `${params.duration} hari`,
    start_date: fmtDate(params.startDate),
    end_date: fmtDate(params.endDate),
    status_label: statusLabel,
    approved_by: params.approvedBy,
    rejection_reason: params.rejectionReason ?? '-',
    system_url: SYSTEM_URL,
  });
}

// ── 4. Notify Applicant: HOD Rejected ────────────────────────────────────────
export async function notifyHODRejected(params: {
  applicantEmail: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  hodName: string;
  rejectionReason?: string;
}): Promise<void> {
  await notifyApplicant({
    applicantEmail: params.applicantEmail,
    applicantName: params.applicantName,
    leaveType: params.leaveType,
    duration: params.duration,
    startDate: params.startDate,
    endDate: params.endDate,
    status: 'rejected',
    approvedBy: params.hodName,
    rejectionReason: params.rejectionReason,
  });
}
