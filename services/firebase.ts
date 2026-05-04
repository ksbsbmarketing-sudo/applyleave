import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  runTransaction,
  deleteDoc,
  updateDoc,
  writeBatch,
  where,
  getDocs
} from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { Staff, LeaveLog, LeaveStatus } from '../types';

const isDemo = !import.meta.env.VITE_FIREBASE_API_KEY || import.meta.env.VITE_FIREBASE_API_KEY === "AIzaSyDummyKey";

let db: any;
let auth: any;

if (!isDemo) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (e) {
    console.error("Firebase init failed, falling back to mock", e);
  }
}

const APP_ID = 'neu-hr-tracker-v1';
const BASE_PATH = `artifacts/${APP_ID}/public/data`;
const STAFF_COLLECTION = `${BASE_PATH}/staff_records`;
const LOGS_COLLECTION = `${BASE_PATH}/logs`;
const SESSIONS_COLLECTION = `${BASE_PATH}/sessions`;

class MockStore {
  private staff: Staff[] = [];
  private logs: LeaveLog[] = [];
  private sessions: any[] = [];
  private staffListeners: ((staff: Staff[]) => void)[] = [];
  private logsListeners: ((logs: LeaveLog[]) => void)[] = [];
  private sessionsListeners: ((sessions: any[]) => void)[] = [];

  constructor() {
    this.load();
  }

  getGenderFromName(name: string): 'male' | 'female' {
    const upper = name.toUpperCase().split(/\s+/);
    return upper.includes('BIN') ? 'male' : 'female';
  }

  private load() {
    try {
      const s = localStorage.getItem('neuhr_staff');
      const l = localStorage.getItem('neuhr_logs');
      const ses = localStorage.getItem('neuhr_sessions');
      if (s) this.staff = JSON.parse(s);
      if (l) this.logs = JSON.parse(l);
      if (ses) this.sessions = JSON.parse(ses);
    } catch (e) { console.error("Mock load error", e); }
  }

  private save() {
    localStorage.setItem('neuhr_staff', JSON.stringify(this.staff));
    localStorage.setItem('neuhr_logs', JSON.stringify(this.logs));
    localStorage.setItem('neuhr_sessions', JSON.stringify(this.sessions));
    this.notify();
  }

  private notify() {
    this.staffListeners.forEach(cb => cb([...this.staff]));
    this.logsListeners.forEach(cb => cb([...this.logs].sort((a, b) => b.timestamp - a.timestamp)));
    this.sessionsListeners.forEach(cb => cb([...this.sessions].sort((a, b) => b.loginTime - a.loginTime)));
  }

  subscribeStaff(cb: (staff: Staff[]) => void) {
    this.staffListeners.push(cb);
    cb([...this.staff]);
    return () => { this.staffListeners = this.staffListeners.filter(l => l !== cb); };
  }

  subscribeLogs(cb: (logs: LeaveLog[]) => void) {
    this.logsListeners.push(cb);
    cb([...this.logs].sort((a, b) => b.timestamp - a.timestamp));
    return () => { this.logsListeners = this.logsListeners.filter(l => l !== cb); };
  }

  subscribeSessions(cb: (sessions: any[]) => void) {
    this.sessionsListeners.push(cb);
    cb([...this.sessions].sort((a, b) => b.loginTime - a.loginTime));
    return () => { this.sessionsListeners = this.sessionsListeners.filter(l => l !== cb); };
  }

  getProRatedAL(staff: Staff) {
    const entitlement = calculateEntitlement(staff.joinDate || new Date().toISOString());
    const currentMonth = new Date().getMonth() + 1;
    const carryForward = Math.min(staff.prevYearBalance || 0, 3);

    // Pro-rate based on entitlement: (Entitlement / 12) * currentMonth
    // We use Math.floor or round based on policy. Let's precise it to 1 decimal or floor? 
    // Usually companies do: (Entitlement / 12 * MonthsWorked).
    const earnedThisYear = (entitlement / 12) * currentMonth;
    const totalAvailable = earnedThisYear + carryForward;

    const currentYear = new Date().getFullYear();
    const usedThisYear = this.logs
      .filter(l => l.staffId === staff.id &&
        l.type === 'AL' &&
        (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending') &&
        new Date(l.startDate).getFullYear() === currentYear)
      .reduce((sum, l) => sum + l.duration, 0);

    return Math.max(0, parseFloat((totalAvailable - usedThisYear).toFixed(1)));
  }

  getUsedCME(staffId: string) {
    const currentYear = new Date().getFullYear();
    return this.logs
      .filter(l => l.staffId === staffId &&
        l.type === 'CME' &&
        (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending') &&
        new Date(l.startDate).getFullYear() === currentYear)
      .reduce((sum, l) => sum + l.duration, 0);
  }

  getAvailableCME(staffId: string) {
    const used = this.getUsedCME(staffId);
    return Math.max(0, 5 - used);
  }

  async seed(initialStaff: Staff[]) {
    let changed = false;

    // Migration: Sanitize any existing hyphenated ICs or IDs in storage
    const initialStaffJSON = JSON.stringify(this.staff);
    this.staff = this.staff.map(s => ({
      ...s,
      id: s.id.replace(/-/g, ''),
      ic: s.ic.replace(/-/g, '')
    }));
    if (JSON.stringify(this.staff) !== initialStaffJSON) changed = true;

    // Remove legacy dummy data if present
    const dummyIdsToRemove = ['admin-001', 'gm-001', 'hod-001', 'hr-001', ''];
    const countBeforeFilter = this.staff.length;
    this.staff = this.staff.filter(s => !dummyIdsToRemove.includes(s.id));
    if (this.staff.length !== countBeforeFilter) changed = true;

    for (const newItem of initialStaff) {
      // Ensure the new seed items are also sanitized before comparison
      const sanitizedNewItem = {
        ...newItem,
        id: newItem.id.replace(/-/g, ''),
        ic: newItem.ic.replace(/-/g, ''),
        gender: newItem.gender || this.getGenderFromName(newItem.name)
      };

      const index = this.staff.findIndex(s => s.id === sanitizedNewItem.id);
      if (index === -1) {
        this.staff.push(sanitizedNewItem);
        changed = true;
      } else {
        // Update existing staff if properties changed (e.g. department added)
        const current = this.staff[index];
        const updated = { ...current, ...sanitizedNewItem }; // Merge new seed data over old data

        if (JSON.stringify(current) !== JSON.stringify(updated)) {
          this.staff[index] = updated;
          changed = true;
        }
      }
    }

    if (changed) {
      this.save();
      // Force notify listeners immediately
      this.staffListeners.forEach(l => l(this.staff));
    }
  }

  async submitLeave(staffId: string, staffName: string, type: 'AL' | 'ML' | 'CME' | 'Paid' | 'Compassionate' | 'Unpaid' | 'Paternity', duration: number, startDate: string, endDate: string, reason: string, dutyHandover: string, hodId?: string, attachmentUrl?: string) {
    const staff = this.staff.find(s => s.id === staffId);
    if (!staff) throw new Error("Staff not found");

    if (type === 'Compassionate' && !attachmentUrl) {
      throw new Error("Sila muat naik surat kematian sebagai bukti untuk Cuti Ehsan.");
    }

    if (type === 'Unpaid' && staff.balanceAL > 0) {
      throw new Error("You must utilize all Annual Leave before applying for Unpaid Leave.");
    }

    // Compassionate Leave Split
    if (type === 'Compassionate' && duration > 3) {
      const ehsanDays = 3;
      const alOverflow = duration - 3;
      
      this.logs.push({
        id: Math.random().toString(36).substr(2, 9),
        staffId, staffName, type: 'Compassionate', duration: ehsanDays,
        timestamp: Date.now(),
        dateString: new Date().toLocaleDateString(),
        startDate, endDate, reason: `${reason} (Portion)`,
        dutyHandover, status: 'pending',
        hodToApprove: hodId,
        attachmentUrl
      });

      return this.submitLeave(staffId, staffName, 'AL', alOverflow, startDate, endDate, `${reason} (Ehsan Overflow)`, dutyHandover, hodId);
    }

    // CME Check & Potential Split to AL
    if (type === 'CME') {
      const availableCME = this.getAvailableCME(staffId);
      if (duration > availableCME) {
        const cmeDays = availableCME;
        const alOverflow = duration - availableCME;

        if (cmeDays > 0) {
          this.logs.push({
            id: Math.random().toString(36).substr(2, 9),
            staffId, staffName, type: 'CME', duration: cmeDays,
            timestamp: Date.now(),
            dateString: new Date().toLocaleDateString(),
            startDate, endDate, reason: `${reason} (Portion)`,
            dutyHandover, status: 'pending',
            hodToApprove: hodId
          });
        }

        // Send overflow to AL logic (which may split to Unpaid further)
        return this.submitLeave(staffId, staffName, 'AL', alOverflow, startDate, endDate, `${reason} (CME Overflow)`, dutyHandover, hodId);
      }
    }

    // Pro-rated AL Check
    if (type === 'AL') {
      const proRatedAvailable = this.getProRatedAL(staff);

      if (duration > proRatedAvailable) {
        // Split logic
        const alDays = proRatedAvailable;
        const unpaidDays = duration - proRatedAvailable;

        if (alDays > 0) {
          // Create AL log for earned portion
          this.logs.push({
            id: Math.random().toString(36).substr(2, 9),
            staffId, staffName, type: 'AL', duration: alDays,
            timestamp: Date.now(),
            dateString: new Date().toLocaleDateString(),
            startDate, endDate, reason: `${reason} (Earned Portion)`,
            dutyHandover, status: 'pending',
            hodToApprove: hodId
          });
        }

        // Create Unpaid log for overflow
        this.logs.push({
          id: Math.random().toString(36).substr(2, 9),
          staffId, staffName, type: 'Unpaid', duration: unpaidDays,
          timestamp: Date.now(),
          dateString: new Date().toLocaleDateString(),
          startDate, endDate, reason: `${reason} (Overflow - Unpaid)`,
          dutyHandover, status: 'pending',
          hodToApprove: hodId
        });

        this.save();
        return { success: true, message: `Split applied: ${alDays > 0 ? alDays + 'd AL, ' : ''}${unpaidDays}d Unpaid` };
      }
    }

    const balance = type === 'AL' ? staff.balanceAL : (type === 'ML' ? staff.balanceML : (type === 'CME' ? 5 : 999));
    if (balance < duration && (type === 'AL' || type === 'ML')) throw new Error(`Insufficient ${type} balance`);

    const log: LeaveLog = {
      id: Math.random().toString(36).substr(2, 9),
      staffId,
      staffName,
      type,
      duration,
      timestamp: Date.now(),
      dateString: new Date().toLocaleDateString(),
      startDate,
      endDate,
      reason,
      dutyHandover,
      status: 'pending',
      hodToApprove: hodId,
      attachmentUrl
    };
    this.logs.push(log);
    this.save();
    return { success: true };
  }

  async approveLeave(logId: string, role: string, approverId: string, locumData?: { locumDoctor: string; locumDate: string; locumBranch: string; }) {
    const logIndex = this.logs.findIndex(l => l.id === logId);
    if (logIndex === -1) throw new Error("Log not found");
    const log = { ...this.logs[logIndex] };

    if (role === 'hod' || role === 'hr') {
      log.status = 'hod_approved';
      log.hodApprovedBy = approverId;
      log.hodApprovedTime = Date.now();
      if (locumData) {
        log.locumDoctor = locumData.locumDoctor;
        log.locumDate = locumData.locumDate;
        log.locumBranch = locumData.locumBranch;
      }
    } else if (role === 'gm' || role === 'admin' || role === 'super_admin') {
      // Allow Admin/GM to override/approve any status visible to them
      log.status = 'approved';
      log.gmApprovedBy = approverId;
      log.gmApprovedTime = Date.now();

      // Deduct balance on GM final approval
      const staffIndex = this.staff.findIndex(s => s.id === log.staffId);
      if (staffIndex !== -1) {
        const staff = { ...this.staff[staffIndex] };
        if (log.type === 'AL') staff.balanceAL -= log.duration;
        else if (log.type === 'ML') staff.balanceML -= log.duration;
        this.staff[staffIndex] = staff;
      }
    }
    this.logs[logIndex] = log;
    this.save();
    return { success: true };
  }

  async rejectLeave(logId: string, reason: string) {
    const logIndex = this.logs.findIndex(l => l.id === logId);
    if (logIndex === -1) throw new Error("Log not found");
    const log = { ...this.logs[logIndex] };
    log.status = 'rejected';
    log.rejectionReason = reason;
    this.logs[logIndex] = log;
    this.save();
    return { success: true };
  }

  async updateStaffData(staffId: string, updates: Partial<Staff>) {
    const idx = this.staff.findIndex(s => s.id === staffId);
    if (idx === -1) throw new Error("Staff not found");

    this.staff[idx] = { ...this.staff[idx], ...updates };

    // If name is updated, propagate to logs and sessions
    if (updates.name) {
      this.logs = this.logs.map(log =>
        log.staffId === staffId ? { ...log, staffName: updates.name! } : log
      );
      this.sessions = this.sessions.map(session =>
        session.staffId === staffId ? { ...session, staffName: updates.name! } : session
      );
    }

    this.save();
  }

  async updateLeaveLog(logId: string, updates: Partial<LeaveLog>) {
    const idx = this.logs.findIndex(l => l.id === logId);
    if (idx === -1) throw new Error("Log not found");
    const oldLog = this.logs[idx];

    // If modifications are made to an APPROVED log (and we aren't just updating the status itself)
    if (oldLog.status === 'approved' && !updates.status) {
      // 1. Refund the old balance
      const staffIdx = this.staff.findIndex(s => s.id === oldLog.staffId);
      if (staffIdx !== -1) {
        const staff = this.staff[staffIdx];
        if (oldLog.type === 'AL') staff.balanceAL += oldLog.duration;
        else if (oldLog.type === 'ML') staff.balanceML += oldLog.duration;
        this.staff[staffIdx] = staff;
      }

      // 2. Revert status to pending so HOD/Admin are "notified" (it appears in their queue)
      updates.status = 'pending';
    }

    this.logs[idx] = { ...this.logs[idx], ...updates };
    this.save();
  }

  async deleteLog(logId: string) {
    const idx = this.logs.findIndex(l => l.id === logId);
    if (idx === -1) throw new Error("Log not found");
    const log = this.logs[idx];

    // Refund balance if it was approved
    if (log.status === 'approved') {
      const staffIdx = this.staff.findIndex(s => s.id === log.staffId);
      if (staffIdx !== -1) {
        const staff = this.staff[staffIdx];
        if (log.type === 'AL') staff.balanceAL += log.duration;
        else if (log.type === 'ML') staff.balanceML += log.duration;
        this.staff[staffIdx] = staff;
      }
    }

    this.logs.splice(idx, 1);
    this.save();
  }

  async login(ic: string, password: string) {
    const staff = this.staff.find(s => s.ic === ic);
    if (!staff) throw new Error("Staff not found");
    if (staff.password && staff.password !== password) throw new Error("Invalid password");

    const session = {
      id: Math.random().toString(36).substr(2, 9),
      staffId: staff.id,
      staffName: staff.name,
      loginTime: Date.now(),
    };
    this.sessions.push(session);
    this.save();
    return staff;
  }

  async register(newStaff: Staff) {
    const existing = this.staff.find(s => s.ic === newStaff.ic);
    if (existing) throw new Error("Staff with this IC already exists");
    this.staff.push(newStaff);
    this.save();
    return newStaff;
  }

  async deleteStaff(staffId: string) {
    this.staff = this.staff.filter(s => s.id !== staffId);
    this.save();
  }
}

const mockStore = new MockStore();

export const initAuth = async () => {
  if (isDemo || !auth) return;
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
  } catch (error) { console.error("Auth Error:", error); }
};

export const seedInitialData = async () => {
  const dummyStaff: Staff[] = [
    // --- Management (Non-Operational) ---
    { id: '770711115447', name: 'MOHD AZLI BIN RAZAK', ic: '770711115447', balanceAL: 14, balanceML: 14, password: 'password123', role: 'hod', address: 'Unknown', phone: '017-6520552', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '801010065052', name: 'FARAHTINA BINTI KAMARUDDIN', ic: '801010065052', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9610169', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '880706065040', name: 'FATIN ZALIKHA BINTI ISMAIL', ic: '880706065040', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '012-9652580', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '760205065687', name: 'MOHD AKMAL BIN SEMAN @ ABD JABAR', ic: '760205065687', balanceAL: 14, balanceML: 14, password: 'password123', role: 'hod', address: 'Unknown', phone: '013-9076837', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '810506035572', name: 'NORHAZLINAH BINTI ALI', ic: '810506035572', balanceAL: 14, balanceML: 14, password: 'password123', role: 'hr', address: 'Unknown', phone: '013-3953646', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '870503115520', name: 'NOOR MARDIYYAH BINTI ABD MANAN', ic: '870503115520', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '012-9470067', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '830501065092', name: 'NOR AIDA BINTI AB AZIZ', ic: '830501065092', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9730694', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '880712065055', name: 'MUHAMMAD LUKHMAN BIN ISMAIL', ic: '880712065055', balanceAL: 14, balanceML: 14, password: 'my@5132129', role: 'staff', address: 'Unknown', phone: '017-8998771', joinDate: '2022-12-12', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, prevYearBalance: 5, department: 'Management' },
    { id: '980605065162', name: 'SYARIFAH NOORLAILATUL SYUHADA BINTI SYED HUSAIN', ic: '980605065162', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '016-9403306', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '891215015798', name: 'SYAFIQA BINTI ABD AZIZ', ic: '891215015798', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '012-9667161', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '010515060256', name: 'INTAN NURFAHADA BINTI MOHAMMAD HIZAM', ic: '010515060256', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '0111-7981205', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '710929065011', name: 'TENGKU ROHSNAN TENGKU ABDUL HAMID', ic: '710929065011', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '016-9518323', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '640622035239', name: 'ABDULLAH SABIL BIN ABU BAKAR', ic: '640622035239', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9509647', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '820410035905', name: 'MOHD SYAHRAIL FIRDAUS BIN CHE MOHD RAHIM', ic: '820410035905', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '017-9773539', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '930712115158', name: 'NUR SAFIRAH BINTI ZAINAL', ic: '930712115158', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '012-9479008', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '800423065689', name: 'MOHD MARZUKI BIN ADBUL AZIZ', ic: '800423065689', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9306088', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '000405060766', name: 'SHARIFAH NURUL IZZAH BT SYED BADARUDDIN', ic: '000405060766', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9100405', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '950204016362', name: 'NURDIANA NABILA BINTI MOHD FAZLI', ic: '950204016362', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '011-25409709', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '960331045042', name: 'SITI HAJAR BINTI ZULKIFLEE', ic: '960331045042', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '011-21474871', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '000205050256', name: 'RADHIAH SYAHINDAH BINTI MD RAZIRAN', ic: '000205050256', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '011-62529586', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '850813065612', name: 'FARIZA BINTI ZAINUDDIN', ic: '850813065612', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '017-8828095', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '950801115596', name: 'NUR SYAZWANI BINTI MOHD NOOR', ic: '950801115596', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '018-9073199', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },
    { id: '970423065074', name: 'SITI MARIANI BINTI RAZAK', ic: '970423065074', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '012-2487426', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Management' },

    // --- Clinic (Operational) ---
    { id: '740407115242', name: 'HASIMAH BINTI MOHAMAD', ic: '740407115242', balanceAL: 14, balanceML: 14, password: 'password123', role: 'hod', address: 'Unknown', phone: '011-29352130', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '910407035647', name: 'WAN MOHAMAD FAIZIN BIN WAN MOHD YUSOFF', ic: '910407035647', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '013-4683842', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '930622115410', name: 'NUR IZZATUL NAJWA BT MOHD HANAN KASHFI', ic: '930622115410', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '016-2232206', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '950505065336', name: 'NOR AIN BINTI AB WAHAB', ic: '950505065336', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9655776', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '940330115485', name: 'WAN MUHAMMAD ARIFF BIN WAN AZAMIN', ic: '940330115485', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '014-8232760', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '810113065295', name: 'MOHD KHAIRUL AZHAR BIN HASAN', ic: '810113065295', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '013-7103307', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '950606115718', name: 'PUTERI AMIRA IRFFA BINTI SAIDI', ic: '950606115718', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '013-9587057', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '010415080022', name: 'NUR SYASYA AFIQAH BINTI MOHD ROSLI', ic: '010415080022', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '011-60764186', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '960406065524', name: 'NOR AZIERAH BINTI ISMAIL', ic: '960406065524', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '012-9216462', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '020304060394', name: 'IRDINA BINTI MOHD HANAFIAH', ic: '020304060394', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '013-9775947', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '980521115046', name: 'NUR AQILAH BINTI ABU BAKAR@AZAHAR', ic: '980521115046', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '011-21890056', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '980419065476', name: 'NABILAH BINTI GHAZALI', ic: '980419065476', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9496587', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '900105035570', name: 'NURAINI BINTI MUSTAPA', ic: '900105035570', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '013-9673449', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '980926115052', name: 'WAN NUR AINA BINTI WAN NAWANG', ic: '980926115052', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '013-6025650', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '000822060126', name: 'NURUL NABILA BINTI MOHD JAILANI', ic: '000822060126', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '010-9176083', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '041105100712', name: 'ADRIANA BATRISYIA BINTI MOHD SHAHRIL PINI', ic: '041105100712', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '011-17970138', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '010716060615', name: 'MUHAMMAD AMIR IRFAN BIN MOHD ZAIDIN', ic: '010716060615', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '011-30322930', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },
    { id: '920601135288', name: 'SITI NURHAFIZAH BINTI HASAN', ic: '920601135288', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '017-5311599', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Operation' },

    // --- Doctors ---
    { id: '700210016105', name: 'DR ZAINAL BIN SULIAN', ic: '700210016105', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '017-9204058', joinDate: '2003-05-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '720107035322', name: 'DR ROHANA BINTI MOHD ZAIN', ic: '720107035322', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '013-9325561', joinDate: '2001-06-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '790725125046', name: 'DR BISME NORIHAN BINTI BORHANUDDIN', ic: '790725125046', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9747952', joinDate: '2007-07-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '770505115358', name: 'DR NUR AKMAL BINTI MOHD ALI', ic: '770505115358', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '012-9514453', joinDate: '2008-07-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '770925065844', name: 'DR ASRATHIAH BINTI AB RAZAK', ic: '770925065844', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9871750', joinDate: '2009-11-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '740409145189', name: 'DR ABDUL WAHID BIN MOHAMMAD WAZIR', ic: '740409145189', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '016-3245118', joinDate: '2011-04-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '880714115511', name: 'DR HASRI BIN HAZNAN', ic: '880714115511', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '019-9347704', joinDate: '2021-06-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '920103065045', name: 'DR SYED FAZREEN BIN SEYED FADZIR', ic: '920103065045', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '014-5308340', joinDate: '2023-09-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },
    { id: '920303115342', name: 'DR FARHAH AMALINA BINTI C.HARUN', ic: '920303115342', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: '016-7027656', joinDate: '2025-08-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, department: 'Doctor', staffType: 'doctor' },

    // Requested Change: Update/Add Main Admin
    { id: '611021065069', name: 'SYED BADARUDDIN BIN SYED ALI', ic: '611021065069', balanceAL: 14, balanceML: 14, password: 'adminpassword', role: 'admin', address: 'Klinik Syed Badaruddin HQ', phone: '012-1111111', joinDate: '1991-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    // Super Admin
    { id: 'super-admin', name: 'Super Admin', ic: 'super_admin', balanceAL: 999, balanceML: 999, password: 'superpassword', role: 'super_admin', address: 'System Root', phone: '000-0000000', joinDate: '2020-01-01', entitlementAL: 999, entitlementML: 999, branch: 'HQ', active: true },
  ];

  if (isDemo || !db) {
    await mockStore.seed(dummyStaff);
    return;
  }

  // CLEANUP: Remove old documents with hyphens in ID
  try {
    const snap = await getDocs(collection(db, STAFF_COLLECTION));
    const batch = writeBatch(db);
    let deletedCount = 0;
    snap.forEach((d) => {
      // old records had hyphens in ID. super-admin is an exception.
      if (d.id.includes('-') && d.id !== 'super-admin') {
        batch.delete(d.ref);
        deletedCount++;
      }
    });
    if (deletedCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }

  for (const staff of dummyStaff) {
    const ref = doc(db, STAFF_COLLECTION, staff.id);
    const snap = await getDoc(ref);
    
    // Auto-calculate gender based on name
    const upper = staff.name.toUpperCase().split(/\s+/);
    const calculatedGender: 'male' | 'female' = upper.includes('BIN') ? 'male' : 'female';

    if (!snap.exists()) {
      staff.gender = calculatedGender;
      await setDoc(ref, staff);
    } else {
      const existingData = snap.data() as Staff;
      if (!existingData.gender) {
        await updateDoc(ref, { gender: calculatedGender });
      }
    }
  }
};

export const subscribeToStaff = (callback: (staff: Staff[]) => void) => {
  if (isDemo || !db) return mockStore.subscribeStaff(callback);
  return onSnapshot(query(collection(db, STAFF_COLLECTION)), (snapshot) => {
    const list: Staff[] = [];
    snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() } as Staff));
    callback(list);
  });
};

export const subscribeToLogs = (callback: (logs: LeaveLog[]) => void) => {
  if (isDemo || !db) return mockStore.subscribeLogs(callback);
  return onSnapshot(query(collection(db, LOGS_COLLECTION), orderBy('timestamp', 'desc')), (snapshot) => {
    const logs: LeaveLog[] = [];
    snapshot.forEach((doc) => logs.push({ id: doc.id, ...doc.data() } as LeaveLog));
    callback(logs);
  });
};

export const submitLeaveApplication = async (
  staffId: string,
  staffName: string,
  type: 'AL' | 'ML' | 'CME' | 'Paid' | 'Compassionate' | 'Unpaid' | 'Paternity',
  duration: number,
  startDate: string,
  endDate: string,
  reason: string,
  dutyHandover: string,
  hodId?: string,
  attachmentUrl?: string
): Promise<{ success: boolean; message?: string; error?: string }> => {
  if (type === 'Compassionate' && !attachmentUrl) {
    return { success: false, error: "Sila muat naik surat kematian sebagai bukti untuk Cuti Ehsan." };
  }

  if (isDemo || !db) {
    try { return await mockStore.submitLeave(staffId, staffName, type, duration, startDate, endDate, reason, dutyHandover, hodId, attachmentUrl); }
    catch (e: any) { return { success: false, error: e.message }; }
  }

  try {
    // Firebase production split logic
    // We need to fetch staff and logs to calculate pro-rating and CME
    const staffRef = doc(db, STAFF_COLLECTION, staffId);
    const staffSnap = await getDoc(staffRef);
    if (!staffSnap.exists()) throw new Error("Staff not found");
    const staff = staffSnap.data() as Staff;

    // Fetch logs for current year
    const currentYear = new Date().getFullYear();
    const logsQ = query(collection(db, LOGS_COLLECTION), where("staffId", "==", staffId));
    const logsSnap = await getDocs(logsQ);
    const userLogs: LeaveLog[] = [];
    logsSnap.forEach(doc => userLogs.push(doc.data() as LeaveLog));

    // Compassionate Leave Rule Max 3
    if (type === 'Compassionate' && duration > 3) {
      const ehsanDays = 3;
      const alOverflow = duration - 3;
      await submitLeaveApplication(staffId, staffName, 'Compassionate', ehsanDays, startDate, endDate, `${reason} (Portion)`, dutyHandover, hodId, attachmentUrl);
      return await submitLeaveApplication(staffId, staffName, 'AL', alOverflow, startDate, endDate, `${reason} (Ehsan Overflow)`, dutyHandover, hodId);
    }

    if (type === 'CME') {
      const usedCME = calculateUsedCME(staffId, userLogs);
      const availableCME = Math.max(0, 5 - usedCME);

      if (duration > availableCME) {
        const cmeDays = availableCME;
        const alOverflow = duration - availableCME;

        if (cmeDays > 0) {
          await submitLeaveApplication(staffId, staffName, 'CME', cmeDays, startDate, endDate, `${reason} (Portion)`, dutyHandover, hodId);
        }
        return await submitLeaveApplication(staffId, staffName, 'AL', alOverflow, startDate, endDate, `${reason} (CME Overflow)`, dutyHandover, hodId);
      }
    }

    if (type === 'AL') {
      const proRatedAvailable = calculateProRatedAL(staff, userLogs);
      if (duration > proRatedAvailable) {
        const alDays = proRatedAvailable;
        const unpaidDays = duration - proRatedAvailable;

        if (alDays > 0) {
          await submitLeaveApplication(staffId, staffName, 'AL', alDays, startDate, endDate, `${reason} (Earned Portion)`, dutyHandover, hodId);
        }
        return await submitLeaveApplication(staffId, staffName, 'Unpaid', unpaidDays, startDate, endDate, `${reason} (Overflow - Unpaid)`, dutyHandover, hodId);
      }
    }

    const newLogRef = doc(collection(db, LOGS_COLLECTION));
    await setDoc(newLogRef, {
      id: newLogRef.id,
      staffId,
      staffName,
      type,
      duration,
      timestamp: Date.now(),
      dateString: new Date().toLocaleDateString(),
      startDate,
      endDate,
      reason,
      dutyHandover,
      status: 'pending',
      hodToApprove: hodId || null,
      attachmentUrl: attachmentUrl || null
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
};

export const calculateYearsOfService = (joinDate: string) => {
  const start = new Date(joinDate);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (months < 0 || (months === 0 && now.getDate() < start.getDate())) {
    years--;
    months += 12;
  }
  return { years, months };
};

export const calculateEntitlement = (joinDate: string) => {
  const { years } = calculateYearsOfService(joinDate);
  if (years < 1) return 0; // Probation/New (< 1 year)
  if (years < 2) return 8; // 1-2 Years
  if (years < 5) return 12; // 2-5 Years
  return 16; // 5+ Years
};

export const calculateProRatedAL = (staff: Staff, logs: LeaveLog[]) => {
  const entitlement = calculateEntitlement(staff.joinDate || new Date().toISOString());
  const currentMonth = new Date().getMonth() + 1;
  const carryForward = Math.min(staff.prevYearBalance || 0, 3);

  const earnedThisYear = (entitlement / 12) * currentMonth;
  const totalAvailable = earnedThisYear + carryForward;

  const currentYear = new Date().getFullYear();
  const usedThisYear = logs
    .filter(l => l.staffId === staff.id &&
      l.type === 'AL' &&
      (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending') &&
      new Date(l.startDate).getFullYear() === currentYear)
    .reduce((sum, l) => sum + l.duration, 0);

  return Math.max(0, parseFloat((totalAvailable - usedThisYear).toFixed(1)));
};

export const calculateUsedCME = (staffId: string, logs: LeaveLog[]) => {
  const currentYear = new Date().getFullYear();
  return logs
    .filter(l => l.staffId === staffId &&
      l.type === 'CME' &&
      (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending') &&
      new Date(l.startDate).getFullYear() === currentYear)
    .reduce((sum, l) => sum + l.duration, 0);
};

export const calculateAvailableCME = (staffId: string, logs: LeaveLog[]) => {
  const used = calculateUsedCME(staffId, logs);
  return Math.max(0, 5 - used);
};

export const approveLeave = async (logId: string, role: 'hod' | 'gm' | 'admin' | 'super_admin', approverId: string, locumData?: { locumDoctor: string; locumDate: string; locumBranch: string; }) => {
  if (isDemo || !db) return await mockStore.approveLeave(logId, role, approverId, locumData);

  try {
    await runTransaction(db, async (transaction) => {
      const logRef = doc(db, LOGS_COLLECTION, logId);
      const logSnap = await transaction.get(logRef);
      if (!logSnap.exists()) throw new Error("Log not found");
      const log = logSnap.data() as LeaveLog;

      if (role === 'hod') {
        const updateData: any = {
          status: 'hod_approved',
          hodApprovedBy: approverId,
          hodApprovedTime: Date.now()
        };
        if (locumData) {
          updateData.locumDoctor = locumData.locumDoctor;
          updateData.locumDate = locumData.locumDate;
          updateData.locumBranch = locumData.locumBranch;
        }
        transaction.update(logRef, updateData);
      } else {
        transaction.update(logRef, {
          status: 'approved',
          gmApprovedBy: approverId,
          gmApprovedTime: Date.now()
        });
        const staffRef = doc(db, STAFF_COLLECTION, log.staffId);
        const staffSnap = await transaction.get(staffRef);
        if (staffSnap.exists()) {
          const staff = staffSnap.data() as Staff;
          if (log.type === 'AL' || log.type === 'ML') {
            const field = log.type === 'AL' ? 'balanceAL' : 'balanceML';
            transaction.update(staffRef, { [field]: staff[field] - log.duration });
          }
        }
      }
    });
    return { success: true };
  } catch (e: any) { throw e; }
};

export const rejectLeave = async (logId: string, reason: string) => {
  if (isDemo || !db) return await mockStore.rejectLeave(logId, reason);
  await updateDoc(doc(db, LOGS_COLLECTION, logId), {
    status: 'rejected',
    rejectionReason: reason
  });
  return { success: true };
};

export const updateStaffData = async (staffId: string, updates: Partial<Staff>) => {
  if (isDemo || !db) return await mockStore.updateStaffData(staffId, updates);

  const batch = writeBatch(db);
  const staffRef = doc(db, STAFF_COLLECTION, staffId);
  batch.update(staffRef, updates);

  if (updates.name) {
    // Update related logs
    const logsQ = query(collection(db, LOGS_COLLECTION), where("staffId", "==", staffId));
    const logsSnap = await getDocs(logsQ);
    logsSnap.forEach((doc) => {
      batch.update(doc.ref, { staffName: updates.name });
    });

    // Update related sessions
    const sessionsQ = query(collection(db, SESSIONS_COLLECTION), where("staffId", "==", staffId));
    const sessionsSnap = await getDocs(sessionsQ);
    sessionsSnap.forEach((doc) => {
      batch.update(doc.ref, { staffName: updates.name });
    });
  }

  await batch.commit();
};

export const deleteLeaveLog = async (logId: string) => {
  if (isDemo || !db) return await mockStore.deleteLog(logId);
  await deleteDoc(doc(db, LOGS_COLLECTION, logId));
};

export const updateLeaveLog = async (logId: string, updates: Partial<LeaveLog>) => {
  if (isDemo || !db) return await mockStore.updateLeaveLog(logId, updates);
  await updateDoc(doc(db, LOGS_COLLECTION, logId), updates);
};

export const loginStaff = async (ic: string, password: string): Promise<Staff> => {
  if (isDemo || !db) return await mockStore.login(ic, password);

  const q = query(collection(db, STAFF_COLLECTION), where("ic", "==", ic));
  const snap = await getDocs(q);

  if (snap.empty) throw new Error("Staff not found");

  const data = snap.docs[0].data() as Staff;
  if (data.password && data.password !== password) throw new Error("Invalid password");

  const sessionRef = doc(collection(db, SESSIONS_COLLECTION));
  await setDoc(sessionRef, { staffId: data.id, staffName: data.name, loginTime: Date.now() });
  return data;
};

export const registerStaff = async (ic: string, name: string, address: string, password: string, branch: string, joinDate: string, staffType: 'admin_staff' | 'operation_staff' | 'doctor', gender: 'male' | 'female'): Promise<Staff> => {
  const newStaff: Staff = { id: ic, name, ic, address, password, balanceAL: 14, balanceML: 14, role: 'staff', branch, joinDate, active: true, staffType, gender };
  if (isDemo || !db) return await mockStore.register(newStaff);
  const staffRef = doc(db, STAFF_COLLECTION, ic);
  if ((await getDoc(staffRef)).exists()) throw new Error("Staff already exists");
  await setDoc(staffRef, newStaff);
  return newStaff;
};

export const deleteStaff = async (staffId: string) => {
  if (isDemo || !db) return await mockStore.deleteStaff(staffId);
  await deleteDoc(doc(db, STAFF_COLLECTION, staffId));
};

export const subscribeToSessions = (callback: (sessions: any[]) => void) => {
  if (isDemo || !db) return mockStore.subscribeSessions(callback);
  return onSnapshot(query(collection(db, SESSIONS_COLLECTION), orderBy('loginTime', 'desc')), (snapshot) => {
    const sessions: any[] = [];
    snapshot.forEach((doc) => sessions.push({ id: doc.id, ...doc.data() }));
    callback(sessions);
  });
};
