// Kalendar cuti bulanan — logik tulen (tiada DOM/Firebase), boleh diuji unit.
//
// Tujuan: HOD/HR nampak siapa bercuti pada hari yang sama sebelum meluluskan
// permohonan baharu. Data datang daripada `leaveRecords` yang sudah dimuat
// (tiada bacaan Firestore tambahan — penting di pelan Spark). Skop zon/cawangan
// dibuat oleh pemanggil melalui filterByScope (masterLogScope.js).

// Status yang dipaparkan. REJECTED/CANCELLED bukan cuti sebenar — disembunyikan.
export const CALENDAR_STATUSES = ['APPROVED', 'PENDING', 'TL APPROVED', 'HOD APPROVED', 'HOD RECOMMENDED'];

export const isOnCalendar = (r) => !!r && CALENDAR_STATUSES.includes(r.status) && !!r.startDate;

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;      // m: 1–12

// Grid bulan bermula Isnin. Pulangkan senarai minggu; setiap sel ialah
// { date: 'YYYY-MM-DD', day, inMonth }.
export function monthGrid(year, month) {                          // month: 1–12
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;                       // Isnin = 0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    const cell = {
      date: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }
  return weeks;
}

// Map 'YYYY-MM-DD' → rekod yang meliputi hari itu, untuk tarikh dalam
// [from, to] (inklusif, rentetan ISO dibanding secara leksikal).
// Cuti merentas bulan dipotong pada sempadan julat.
export function leavesByDay(records, from, to) {
  const map = new Map();
  for (const r of records || []) {
    if (!isOnCalendar(r)) continue;
    const start = r.startDate;
    const end = r.endDate && r.endDate >= start ? r.endDate : start;
    if (end < from || start > to) continue;
    const lo = start < from ? from : start;
    const hi = end > to ? to : end;
    const [y, m, d] = lo.split('-').map(Number);
    for (let t = Date.UTC(y, m - 1, d); ; t += 86400000) {
      const dt = new Date(t);
      const key = ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      if (key > hi) break;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
  }
  // Lulus dahulu, kemudian ikut nama — susunan stabil dalam sel.
  for (const list of map.values()) {
    list.sort((a, b) => (a.status === 'APPROVED' ? 0 : 1) - (b.status === 'APPROVED' ? 0 : 1)
      || String(a.name || '').localeCompare(String(b.name || '')));
  }
  return map;
}

// Navigasi bulan: shiftMonth('2026-01', -1) → '2025-12'
export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

const MONTHS_MS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_MS[m - 1]} ${y}`;
};
