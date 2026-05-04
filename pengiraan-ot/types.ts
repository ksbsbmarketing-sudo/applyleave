export interface Staff {
  id: string; // Typically the IC number
  name: string;
  ic: string;
  email?: string; // Email for notifications (mandatory in UI)
  phone?: string;
  balanceAL: number; // Annual Leave
  balanceMC: number; // Medical Leave
  balanceHL?: number; // Hospitalization Leave
  balanceRL?: number; // Replacement Leave
  password?: string;
  role?: 'admin' | 'staff' | 'hod' | 'gm' | 'hr' | 'super_admin';
  address?: string;
  department?: string;
  joinDate?: string;
  entitlementAL?: number;
  entitlementMC?: number;
  entitlementHL?: number;
  entitlementRL?: number;
  branch?: string;
  active?: boolean;
  prevYearBalance?: number;
  staffType?: 'admin_staff' | 'operation_staff' | 'doctor';
  gender?: 'male' | 'female';
  basicSalary?: number;
  waApiKey?: string;
  sessionId?: string;
}


export const PAHANG_BRANCHES = [
  "Klinik Syed Badaruddin Balok (HQ)",
  "Klinik Syed Badaruddin Beserah",
  "Klinik Syed Badaruddin Gebeng",
  "Klinik Syed Badaruddin Kempadang",
  "Uni Klinik Bentong",
  "Klinik Syed Badaruddin MCKIP"
];

export const TERENGGANU_BRANCHES = [
  "Klinik Syed Badaruddin Kerteh",
  "Klinik Syed Badaruddin Paka",
  "Klinik Rakyat dan X-Ray Dungun",
  "Klinik Syed Badaruddin Utama"
];

export const BRANCH_GROUPS = {
  "Pahang Site": PAHANG_BRANCHES,
  "Terengganu Site": TERENGGANU_BRANCHES
};

export const BRANCHES = [
  ...PAHANG_BRANCHES,
  ...TERENGGANU_BRANCHES
];

export type LeaveStatus = 'pending' | 'hod_approved' | 'hr_approved' | 'approved' | 'rejected';

export interface LeaveLog {
  id: string;
  staffId: string;
  staffName: string;
  type: 'AL' | 'MC' | 'HL' | 'ML' | 'PL' | 'EL' | 'BL' | 'RL' | 'UL' | 'CME';
  duration: number;
  timestamp: number; // Unix timestamp
  dateString: string; // Human readable date for easy filtering
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
  dutyHandover?: string;
  attachmentUrl?: string; // Base64 or URL for compassionate leave proof
  status: LeaveStatus;
  hodApprovedBy?: string;
  hodApprovedTime?: number;
  locumDoctor?: string; // Appointed locum doctor (only for pahang doctors)
  locumDate?: string; // Date of the locum
  locumBranch?: string; // Branch where locum takes place
  locumStartTime?: string; // HH:mm
  locumEndTime?: string; // HH:mm
  gmApprovedBy?: string;
  gmApprovedTime?: number;
  rejectionReason?: string;
  hodToApprove?: string; // Specify which HOD should approve
}

export interface UserSession {
  id: string;
  staffId: string;
  staffName: string;
  loginTime: number;
  ipAddress?: string;
  device?: string;
}

export interface SummaryStats {
  totalDays: number;
  topTaker: string;
  monthlyTrend: { name: string; days: number }[];
}

// For Charting
export interface MonthlyData {
  name: string;
  AL: number;
  ML: number;
}

export interface OvertimeLog {
  id: string;
  staffId: string;
  staffName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  duration: number; // in hours
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: number;
  approvedBy?: string;
  approvedTime?: number;
  rejectionReason?: string;
  otType: 'ot15' | 'ot20' | 'ot30' | 'mixed';
  hourlyRate: number;
  paymentAmount: number;
  // Breakdown for mixed claims
  h15?: number;
  h20?: number;
  h30?: number;
  p15?: number;
  p20?: number;
  p30?: number;
  isPrinted?: boolean;
}
