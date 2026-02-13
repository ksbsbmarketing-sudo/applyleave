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
    const currentMonth = new Date().getMonth() + 1;
    const earned = currentMonth * 1; // 1 day per month

    const currentYear = new Date().getFullYear();
    const usedThisYear = this.logs
      .filter(l => l.staffId === staff.id &&
        l.type === 'AL' &&
        (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending') &&
        new Date(l.startDate).getFullYear() === currentYear)
      .reduce((sum, l) => sum + l.duration, 0);

    return Math.max(0, earned - usedThisYear);
  }

  async seed(initialStaff: Staff[]) {
    if (this.staff.length === 0) {
      this.staff = initialStaff;
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
    } else if (role === 'gm' || role === 'admin') {
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
    { id: 'admin-001', name: 'Dr. Syed Badaruddin', ic: 'admin-001', balanceAL: 14, balanceML: 14, password: 'adminpassword', role: 'admin', address: 'Klinik Syed Badaruddin HQ', phone: '012-1111111', joinDate: '1991-01-01', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    { id: 'gm-001', name: 'Sarah Connor', ic: 'gm-001', balanceAL: 14, balanceML: 14, password: 'gmpassword', role: 'gm', address: 'Management Office', phone: '012-2222222', joinDate: '2015-05-12', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Balok (HQ)', active: true },
    { id: 'hod-001', name: 'John Doe', ic: 'hod-001', balanceAL: 14, balanceML: 14, password: 'hodpassword', role: 'hod', address: 'Medical Dept', phone: '012-3333333', joinDate: '2018-10-20', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Beserah', active: true },
    { id: 'hr-001', name: 'Zoe Wong', ic: 'hr-001', balanceAL: 14, balanceML: 14, password: 'hrpassword', role: 'hr', address: 'HR Dept', phone: '012-4444444', joinDate: '2020-02-15', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Gebeng', active: true },
    { id: '880101-10-1234', name: 'Alice Tan', ic: '880101-10-1234', balanceAL: 14, balanceML: 14, password: 'password123', role: 'staff', address: '123 Tech Lane', phone: '012-5555555', joinDate: '2022-12-12', entitlementAL: 14, entitlementML: 14, branch: 'Klinik Syed Badaruddin Kempadang', active: true },
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

export const calculateProRatedAL = (staff: Staff, logs: LeaveLog[]) => {
  const currentMonth = new Date().getMonth() + 1;
  const earned = currentMonth * 1;
  const currentYear = new Date().getFullYear();
  const usedThisYear = logs
    .filter(l => l.staffId === staff.id &&
      l.type === 'AL' &&
      (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending') &&
      new Date(l.startDate).getFullYear() === currentYear)
    .reduce((sum, l) => sum + l.duration, 0);

  return Math.max(0, earned - usedThisYear);
};

export const approveLeave = async (logId: string, role: 'hod' | 'gm' | 'admin', approverId: string) => {
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

export const registerStaff = async (ic: string, name: string, address: string, password: string, branch: string): Promise<Staff> => {
  const newStaff: Staff = { id: ic, name, ic, address, password, balanceAL: 14, balanceML: 14, role: 'staff', branch };
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