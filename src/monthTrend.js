// Julat bulan bagi carta "Trend Permohonan Bulanan" (Analisa Cuti, admin).
//
// Dulu carta sentiasa tunjuk Jan–Dis, jadi bulan sebelum sistem digunakan
// mengambil separuh lebar carta, dan bulan semasa (belum habis) nampak seperti
// penurunan. Tiada DOM/Chart.js di sini — boleh diuji unit.
//
// counts   : 12 kiraan bulanan (Jan = 0)
// year     : tahun ditapis ('2026') atau 'SEMUA'
// selected : bulan ditapis, 1–12 (0 = tiada)
// Pulangan : { start, end, partial } — indeks bulan (0–11); partial = bulan
//            semasa yang belum habis, atau -1.
export function trendWindow(counts, { year, selected = 0, now = new Date() } = {}) {
  const isCurrentYear = String(year) === String(now.getFullYear());
  const firstData = counts.findIndex(c => c > 0);
  let start = firstData < 0 ? 0 : firstData;
  let end = isCurrentYear ? now.getMonth() : 11;
  if (isCurrentYear) {
    const lastData = counts.reduce((last, c, i) => (c > 0 ? i : last), -1);
    end = Math.max(end, lastData);
  }
  if (selected > 0) {
    start = Math.min(start, selected - 1);
    end = Math.max(end, selected - 1);
  }
  start = Math.min(start, end);
  return { start, end, partial: isCurrentYear ? now.getMonth() : -1 };
}
