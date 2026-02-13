export interface Staff {
  id: string; // Typically the IC number
  name: string;
  ic: string;
  balanceAL: number; // Annual Leave
  balanceML: number; // Medical Leave
  password?: string; // Optional password for login
  role?: 'admin' | 'staff' | 'hod' | 'gm' | 'hr';
  address?: string;
  phone?: string;
  department?: string; // Optional for HOD routing
  joinDate?: string; // YYYY-MM-DD
  entitlementAL?: number;
  entitlementML?: number;
  branch?: string;
  active?: boolean;
}

export const BRANCHES = [
  "Klinik Syed Badaruddin Balok (HQ)",
  "Klinik Syed Badaruddin Beserah",
  "Klinik Syed Badaruddin Gebeng",
  "Klinik Syed Badaruddin Kempadang",
  "Klinik Syed Badaruddin MCKIP",
  "Klinik Syed Badaruddin Utama",
  "Klinik Syed Badaruddin Kerteh",
  "Klinik Syed Badaruddin Paka",
  "Klinik Rakyat dan X-Ray Dungun",
  "Uni Klinik Bentong"
];

export type LeaveStatus = 'pending' | 'hod_approved' | 'approved' | 'rejected';

export interface LeaveLog {
  id: string;
  staffId: string;
  staffName: string;
  type: 'AL' | 'ML' | 'CME' | 'Paid' | 'Compassionate' | 'Unpaid';
  duration: number;
  timestamp: number; // Unix timestamp
  dateString: string; // Human readable date for easy filtering
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
  dutyHandover?: string;
  status: LeaveStatus;
  hodApprovedBy?: string;
  hodApprovedTime?: number;
  gmApprovedBy?: string;
  gmApprovedTime?: number;
  rejectionReason?: string;
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
