import { isISODate, recurringError } from './recurringPlanModel.js';

function utcParts(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

function daysInUTCMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarMonthsClamped(iso, count) {
  const { year, month, day } = utcParts(iso);
  const total = year * 12 + month - 1 + count;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const nextDay = Math.min(day, daysInUTCMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}

function dayDifference(fromISO, toISO) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);
}

export function calendarDuration(startDate, referenceDate) {
  if (!isISODate(startDate) || !isISODate(referenceDate)) recurringError('invalid_duration_date', '持续时间日期无效');
  if (referenceDate < startDate) recurringError('negative_elapsed_duration', '持续时间不能为负数');
  let totalMonths = (Number(referenceDate.slice(0, 4)) - Number(startDate.slice(0, 4))) * 12
    + Number(referenceDate.slice(5, 7)) - Number(startDate.slice(5, 7));
  let anchor = addCalendarMonthsClamped(startDate, totalMonths);
  if (anchor > referenceDate) {
    totalMonths -= 1;
    anchor = addCalendarMonthsClamped(startDate, totalMonths);
  }
  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
    days: dayDifference(anchor, referenceDate),
  };
}

export function formatCalendarDurationChinese(duration, prefix = '') {
  const parts = [];
  if (duration.years) parts.push(`${duration.years}年`);
  if (duration.months) parts.push(`${duration.months}个月`);
  if (duration.days || !parts.length) parts.push(`${duration.days}天`);
  return `${prefix}${parts.join(' ')}`;
}

export function elapsedDurationChinese(startDate, referenceDate, prefix = '') {
  return formatCalendarDurationChinese(calendarDuration(startDate, referenceDate), prefix);
}
