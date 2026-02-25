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

const isDemo = !process.env.FIREBASE_API_KEY || process.env.FIREBASE_API_KEY === "AIzaSyDummyKey";

let db: any;
let auth: any;

if (!isDemo) {
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
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

  async seed(initialStaff: Staff[]) {
    let changed = false;

    // Remove legacy dummy data if present
    const dummyIdsToRemove = ['admin-001', 'gm-001', 'hod-001', 'hr-001', '880101-10-1234'];
    const initialLength = this.staff.length;
    this.staff = this.staff.filter(s => !dummyIdsToRemove.includes(s.id));
    if (this.staff.length !== initialLength) changed = true;

    for (const newItem of initialStaff) {
      const exists = this.staff.find(s => s.id === newItem.id);
      if (!exists) {
        this.staff.push(newItem);
        changed = true;
      } else {
        // Optional: Update existing seed data if needed (e.g. role changes)
        // For now, we'll assume we only want to ensure they exist
      }
    }
    if (changed) {
      this.save();
    }
  }

  async submitLeave(staffId: string, staffName: string, type: 'AL' | 'ML' | 'CME' | 'Paid' | 'Compassionate' | 'Unpaid', duration: number, startDate: string, endDate: string, reason: string, dutyHandover: string) {
    const staff = this.staff.find(s => s.id === staffId);
    if (!staff) throw new Error("Staff not found");

    if (type === 'Unpaid' && staff.balanceAL > 0) {
      throw new Error("You must utilize all Annual Leave before applying for Unpaid Leave.");
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
            dutyHandover, status: 'pending'
          });
        }

        // Create Unpaid log for overflow
        this.logs.push({
          id: Math.random().toString(36).substr(2, 9),
          staffId, staffName, type: 'Unpaid', duration: unpaidDays,
          timestamp: Date.now(),
          dateString: new Date().toLocaleDateString(),
          startDate, endDate, reason: `${reason} (Overflow - Unpaid)`,
          dutyHandover, status: 'pending'
        });

        this.save();
        return { success: true, message: `Split: ${alDays}d AL, ${unpaidDays}d Unpaid` };
      }
    }

    const balance = type === 'AL' ? staff.balanceAL : (type === 'ML' ? staff.balanceML : 999);
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
      status: 'pending'
    };
    this.logs.push(log);
    this.save();
    return { success: true };
  }

  async approveLeave(logId: string, role: string, approverId: string) {
    const logIndex = this.logs.findIndex(l => l.id === logId);
    if (logIndex === -1) throw new Error("Log not found");
    const log = { ...this.logs[logIndex] };

    if (role === 'hod') {
      log.status = 'hod_approved';
      log.hodApprovedBy = approverId;
      log.hodApprovedTime = Date.now();
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
    this.logs[idx] = { ...this.logs[idx], ...updates };
    this.save();
  }

  async deleteLog(logId: string) {
    this.logs = this.logs.filter(l => l.id !== logId);
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
    { id: '770711-11-5447', name: 'MOHD AZLI BIN RAZAK', ic: '770711-11-5447', balanceAL: 14, balanceML: 14, password: 'password123', role: 'hod', address: 'Unknown', phone: 'N/A', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    { id: '801010-06-5052', name: 'FARAHTINA BINTI KAMARUDDIN', ic: '801010-06-5052', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: 'N/A', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    { id: '880706-06-5040', name: 'FATIN ZALIKHA BINTI ISMAIL', ic: '880706-06-5040', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: 'Unknown', phone: 'N/A', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    { id: '760205-06-5687', name: 'MOHD AKMAL BIN SEMAN @ ABD JABAR', ic: '760205-06-5687', balanceAL: 14, balanceML: 14, password: 'password123', role: 'hod', address: 'Unknown', phone: 'N/A', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    { id: '810506-03-5572', name: 'NORHAZLINAH BINTI ALI', ic: '810506-03-5572', balanceAL: 14, balanceML: 14, password: 'password123', role: 'hr', address: 'Unknown', phone: 'N/A', joinDate: '2024-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    { id: '880712-06-5055', name: 'MUHAMMAD LUKHMAN BIN ISMAIL', ic: '880712-06-5055', balanceAL: 14, balanceML: 14, password: 'my@5132129', role: 'staff', address: 'Unknown', phone: 'N/A', joinDate: '2022-12-12', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true, prevYearBalance: 5 },
    // Requested Change: Update/Add Main Admin
    { id: '611021-06-5069', name: 'SYED BADARUDDIN BIN SYED ALI', ic: '611021-06-5069', balanceAL: 14, balanceML: 14, password: 'adminpassword', role: 'admin', address: 'Klinik Syed Badaruddin HQ', phone: '012-1111111', joinDate: '1991-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    // Super Admin
    { id: 'super-admin', name: 'Super Admin', ic: 'super_admin', balanceAL: 999, balanceML: 999, password: 'superpassword', role: 'super_admin', address: 'System Root', phone: '000-0000000', joinDate: '2020-01-01', entitlementAL: 999, entitlementML: 999, branch: 'HQ', active: true },
  ];

  if (isDemo || !db) {
    await mockStore.seed(dummyStaff);
    return;
  }

  for (const staff of dummyStaff) {
    const ref = doc(db, STAFF_COLLECTION, staff.id);
    await setDoc(ref, staff, { merge: true });
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
  type: 'AL' | 'ML' | 'CME' | 'Paid' | 'Compassionate' | 'Unpaid',
  duration: number,
  startDate: string,
  endDate: string,
  reason: string,
  dutyHandover: string
): Promise<{ success: boolean; error?: string }> => {
  if (isDemo || !db) {
    try { return await mockStore.submitLeave(staffId, staffName, type, duration, startDate, endDate, reason, dutyHandover); }
    catch (e: any) { return { success: false, error: e.message }; }
  }

  try {
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
      status: 'pending'
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

export const approveLeave = async (logId: string, role: 'hod' | 'gm' | 'admin' | 'super_admin', approverId: string) => {
  if (isDemo || !db) return await mockStore.approveLeave(logId, role, approverId);

  try {
    await runTransaction(db, async (transaction) => {
      const logRef = doc(db, LOGS_COLLECTION, logId);
      const logSnap = await transaction.get(logRef);
      if (!logSnap.exists()) throw new Error("Log not found");
      const log = logSnap.data() as LeaveLog;

      if (role === 'hod') {
        transaction.update(logRef, {
          status: 'hod_approved',
          hodApprovedBy: approverId,
          hodApprovedTime: Date.now()
        });
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
  const staffRef = doc(db, STAFF_COLLECTION, ic);
  const snapshot = await getDoc(staffRef);
  if (!snapshot.exists()) throw new Error("Staff not found");
  const data = snapshot.data() as Staff;
  if (data.password && data.password !== password) throw new Error("Invalid password");

  const sessionRef = doc(collection(db, SESSIONS_COLLECTION));
  await setDoc(sessionRef, { staffId: data.id, staffName: data.name, loginTime: Date.now() });
  return data;
};

export const registerStaff = async (ic: string, name: string, address: string, password: string, branch: string, joinDate: string): Promise<Staff> => {
  const newStaff: Staff = { id: ic, name, ic, address, password, balanceAL: 14, balanceML: 14, role: 'staff', branch, joinDate, active: true };
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