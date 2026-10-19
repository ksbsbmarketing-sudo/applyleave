// Helper paparan Login Logs (audit_logs) — kategori aktiviti, carian dan statistik.
//
// Dulu skrin ini jadual rata 4 lajur tanpa carian atau penapis: 200 baris yang
// perlu diskrol satu-satu. Logik tulen di sini (tiada DOM/Firebase) supaya boleh
// diuji unit; HTML dibina dalam main.js (managementTab 'login_audit').
//
// Teks aktiviti ditulis oleh window.logSystemActivity dalam bahasa Inggeris
// ("Logged into system", "Approved Leave (Final) for …"), jadi kategori diteka
// daripada teks itu. Urutan peraturan penting: "Rejected registration" ialah
// tolak, bukan akaun.

const PATHS = {
  login:   '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  doc:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  check:   '<polyline points="20 6 9 17 4 12"/>',
  x:       '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  user:    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  gear:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-2.82-1.17l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 13.09H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.17-2.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9.91 3V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 9.91V10a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  phone:   '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
};

// key → label paparan, ikon, tona (sama nama tona dengan .inbox-kind)
export const AUDIT_CATEGORIES = [
  { key: 'login',   label: 'Log Masuk',      icon: 'login', tone: 'info' },
  { key: 'apply',   label: 'Permohonan',     icon: 'doc',   tone: 'action' },
  { key: 'approve', label: 'Kelulusan',      icon: 'check', tone: 'ok' },
  { key: 'reject',  label: 'Tolak / Batal',  icon: 'x',     tone: 'bad' },
  { key: 'account', label: 'Akaun & Staf',   icon: 'user',  tone: 'warn' },
  { key: 'system',  label: 'Lain-lain',      icon: 'gear',  tone: 'muted' },
];
const BY_KEY = Object.fromEntries(AUDIT_CATEGORIES.map(c => [c.key, c]));

const RULES = [
  ['login',   /^logged in/i],
  ['reject',  /^(rejected|cancelled)\b/i],
  ['approve', /^approved\b|supported leave/i],
  ['apply',   /^applied for|edited (own )?leave|re-uploaded proof|maklumat locum/i],
  ['account', /staff|registration|google|profile|renamed/i],
];

export const auditCategoryKey = (activity) => {
  const s = String(activity ?? '');
  const hit = RULES.find(([, re]) => re.test(s));
  return hit ? hit[0] : 'system';
};

export const auditCategory = (activity) => {
  const c = BY_KEY[auditCategoryKey(activity)];
  return { ...c, svg: PATHS[c.icon] };
};

// log.ip sebenarnya label peranti ("Windows Web" / "Mac OS Web" / "Mobile/Web").
export const auditDevice = (log) => {
  const label = String(log?.ip ?? '').trim() || 'Tidak diketahui';
  const mobile = /mobile/i.test(label);
  return { label: mobile ? 'Telefon / Web' : label, svg: PATHS[mobile ? 'phone' : 'desktop'] };
};

// Penapis kategori + carian (nama, IC, cawangan, teks aktiviti). Kekalkan urutan asal.
export const filterAuditLogs = (list, { cat = 'all', q = '' } = {}) => {
  const needle = String(q).trim().toLowerCase();
  return (list || []).filter(log => {
    if (cat !== 'all' && auditCategoryKey(log.activity) !== cat) return false;
    if (!needle) return true;
    return [log.name, log.userId, log.branch, log.activity]
      .some(v => String(v ?? '').toLowerCase().includes(needle));
  });
};

// Bilangan setiap kategori — untuk lencana pada cip penapis.
export const auditCounts = (list) => {
  const counts = { all: 0 };
  AUDIT_CATEGORIES.forEach(c => { counts[c.key] = 0; });
  (list || []).forEach(log => { counts.all++; counts[auditCategoryKey(log.activity)]++; });
  return counts;
};

// Ringkasan "hari ini": aktiviti, log masuk, pengguna unik (ikut IC).
// msOf menukar log → epoch ms (main.js hantar auditMillis(log.createdAt)).
export const auditTodayStats = (list, msOf, now = Date.now()) => {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const today = (list || []).filter(log => msOf(log) >= start.getTime());
  return {
    events: today.length,
    logins: today.filter(log => auditCategoryKey(log.activity) === 'login').length,
    users: new Set(today.map(log => log.userId).filter(Boolean)).size,
  };
};
