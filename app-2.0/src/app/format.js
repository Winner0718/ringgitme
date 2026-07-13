// Formatting utilities — DD/MM/YYYY, h:mm AM/PM, RM tabular amounts.
// These mirror the frozen legacy semantics (formatDateMY19_1A /
// formatTimeAMPM19_1A) and must stay the single formatting source for 2.0.

export function fmtRM(value, { sign = false, privacy = false } = {}) {
  if (privacy) return 'RM ••••';
  const n = Number(value) || 0;
  const abs = Math.abs(n).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${prefix}RM ${abs}`;
}

export function fmtDateMY(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

export function fmtTimeAMPM(hhmm) {
  let [h, m] = String(hhmm).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

export function parseDateMY(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value).trim());
  if (!match) throw new Error('日期格式应为 DD/MM/YYYY');
  const [, dd, mm, yyyy] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (date.getFullYear() !== Number(yyyy) || date.getMonth() + 1 !== Number(mm) || date.getDate() !== Number(dd)) throw new Error('日期无效');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseTimeAMPM(value) {
  const match = /^(1[0-2]|[1-9]):([0-5]\d)\s*(AM|PM)$/i.exec(String(value).trim());
  if (!match) throw new Error('时间格式应为 h:mm AM/PM');
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

// Local-date ISO (never toISOString — that shifts to UTC and
// moves dates across midnight in MYT).
export function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayISO() {
  return toLocalISO(new Date());
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalISO(d);
}

export function daysBetween(fromISO, toISO) {
  const a = new Date(`${fromISO}T00:00:00`);
  const b = new Date(`${toISO}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

// "15/07/2026 · 星期三" style weekday label for activity group headers
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function fmtDayHeader(iso, today = todayISO()) {
  const diff = daysBetween(iso, today);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${fmtDateMY(iso)} ${WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]}`;
}

export function escapeHTML(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
