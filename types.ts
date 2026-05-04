export interface Staff {
  id: string; // Typically the IC number
  name: string;
  ic: string;
  balanceAL: number; // Annual Leave
  balanceML: number; // Medical Leave
  password?: string; // Optional password for login
  role?: 'admin' | 'staff' | 'hod' | 'gm' | 'hr' | 'super_admin';
  address?: string;
  phone?: string;
  department?: string; // Optional for HOD routing
  joinDate?: string; // YYYY-MM-DD
  entitlementAL?: number;
  entitlementML?: number;
  branch?: string;
  active?: boolean;
  prevYearBalance?: number; // Balance remaining from previous year
  staffType?: 'admin_staff' | 'operation_staff' | 'doctor';
  gender?: 'male' | 'female';
}

export const PAHANG_BRANCHES = [
  "Klinik Syed Badaruddin Balok (HQ)",
  "Klinik Syed Badaruddin Beserah",
  "Klinik Syed Badaruddin Gebeng",
  "Klinik Syed Badaruddin Kempadang",
  "Uni Klinik Bentong"
];

export const TERENGGANU_BRANCHES = [
  "Klinik Syed Badaruddin Kerteh",
  "Klinik Syed Badaruddin Paka",
  "Klinik Rakyat dan X-Ray Dungun",
  "Klinik Syed Badaruddin Utama",
  "Klinik Syed Badaruddin MCKIP"
];

export const BRANCH_GROUPS = {
  "Pahang Site": PAHANG_BRANCHES,
  "Terengganu Site": TERENGGANU_BRANCHES
};

export const BRANCHES = [
  ...PAHANG_BRANCHES,
  ...TERENGGANU_BRANCHES
];

export type LeaveStatus = 'pending' | 'hod_approved' | 'approved' | 'rejected';

export interface LeaveLog {
  id: string;
  staffId: string;
  staffName: string;
  type: 'AL' | 'ML' | 'CME' | 'Paid' | 'Compassionate' | 'Unpaid' | 'Paternity';
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
  ipAddress?: string; // Optional metadata
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
