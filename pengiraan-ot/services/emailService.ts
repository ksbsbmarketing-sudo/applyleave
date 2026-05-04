/**
 * Email Notification Service — Klinik Syed Badaruddin
 * Uses EmailJS (https://www.emailjs.com) — free, client-side, no backend needed.
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://www.emailjs.com and create a free account
 * 2. Add an Email Service (Gmail recommended) → copy the SERVICE_ID
 * 3. Create 3 Email Templates (see template structure below) → copy TEMPLATE IDs
 * 4. Go to Account → Public Key → copy PUBLIC_KEY
 * 5. Replace the values below with your own credentials
 *
 * EMAIL TEMPLATES TO CREATE IN EMAILJS DASHBOARD:
 *
 * Template 1: "leave_to_hod" (New Application → HOD)
 *   Subject: "Permohonan Cuti Baharu — {{applicant_name}}"
 *   Variables: to_email, to_name, applicant_name, leave_type, duration, start_date, end_date, reason, branch
 *
 * Template 2: "leave_to_admin" (HOD Approved → Admin)
 *   Subject: "Cuti Menunggu Kelulusan Admin — {{applicant_name}}"
 *   Variables: to_email, to_name, applicant_name, leave_type, duration, start_date, end_date, hod_name, branch
 *
 * Template 3: "leave_to_applicant" (Final result → Staff)
 *   Subject: "Status Permohonan Cuti Anda — {{status_label}}"
 *   Variables: to_email, to_name, leave_type, duration, start_date, end_date, status_label, approved_by, rejection_reason
 */

// ── CONFIGURE YOUR EMAILJS CREDENTIALS HERE ─────────────────────────────────
const EMAILJS_PUBLIC_KEY  = 'dq2hw-YDGeRj5Fauv';  // ✅ Set
const EMAILJS_SERVICE_ID  = 'service_tzowoyo';   // ✅ Set
const EMAILJS_TEMPLATE_HOD     = 'leave_to_hod';     // Template for HOD notification
const EMAILJS_TEMPLATE_ADMIN   = 'leave_to_admin';    // Template for Admin notification
const EMAILJS_TEMPLATE_STAFF   = 'leave_to_applicant'; // Template for Applicant notification

// ─────────────────────────────────────────────────────────────────────────────

const isConfigured =
  EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY' &&
  EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID';

const EMAILJS_API = 'https://api.emailjs.com/api/v1.0/email/send';

async function sendEmail(templateId: string, params: Record<string, string>): Promise<void> {
  if (!isConfigured) {
    console.warn('[EmailService] EmailJS not configured. Email skipped:', templateId, params);
    return;
  }
  try {
    const body = {
      service_id: EMAILJS_SERVICE_ID,
      template_id: templateId,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: params,
    };
    const res = await fetch(EMAILJS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[EmailService] Failed to send email:', text);
    }
  } catch (err) {
    console.error('[EmailService] Network error:', err);
  }
}

// ── Leave type label helper ───────────────────────────────────────────────────
export function leaveTypeLabel(type: string): string {
  const map: Record<string, string> = {
    AL: 'Cuti Tahunan (Annual Leave)',
    ML: 'Cuti Sakit / Medical Leave',
    CME: 'CME Leave',
    Compassionate: 'Cuti Ehsan (Compassionate)',
    Emergency: 'Cuti Kecemasan (Emergency)',
    Unpaid: 'Cuti Tanpa Gaji (Unpaid)',
    Paternity: 'Cuti Bersalin / Paternity',
    Paid: 'Cuti Berbayar (Paid)',
  };
  return map[type] ?? type;
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
    start_date: new Date(params.startDate).toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' }),
    end_date: new Date(params.endDate).toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' }),
    reason: params.reason,
    branch: params.branch,
    system_url: 'https://ksbsb-leave-trcker.web.app',
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
    start_date: new Date(params.startDate).toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' }),
    end_date: new Date(params.endDate).toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' }),
    hod_name: params.hodName,
    branch: params.branch,
    system_url: 'https://ksbsb-leave-trcker.web.app',
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
    ? '✅ DILULUSKAN (Approved)'
    : '❌ DITOLAK (Rejected)';

  await sendEmail(EMAILJS_TEMPLATE_STAFF, {
    to_email: params.applicantEmail,
    to_name: params.applicantName,
    leave_type: leaveTypeLabel(params.leaveType),
    duration: `${params.duration} hari`,
    start_date: new Date(params.startDate).toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' }),
    end_date: new Date(params.endDate).toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' }),
    status_label: statusLabel,
    approved_by: params.approvedBy,
    rejection_reason: params.rejectionReason ?? '-',
    system_url: 'https://ksbsb-leave-trcker.web.app',
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
