// Pure schedule math shared by monthly relationship accounts and
// interpersonal instalments. Deterministic: same plan input always produces
// the identical period keys, due dates and rounded per-term amounts.

export function periodKeyOf(dateISO) {
  return String(dateISO).slice(0, 7);
}

export function daysInMonth(periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function dueDateFor(periodKey, dueDay) {
  const day = Math.min(Math.max(1, Number(dueDay) || 1), daysInMonth(periodKey));
  return `${periodKey}-${String(day).padStart(2, '0')}`;
}

export function addMonths(periodKey, count) {
  const [year, month] = periodKey.split('-').map(Number);
  const total = year * 12 + (month - 1) + count;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function comparePeriods(a, b) {
  return String(a).localeCompare(String(b));
}

// Instalments: floor every term to the cent, final term absorbs the rounding
// difference so the schedule always sums exactly to totalRepayableMinor.
export function installmentSchedule({ totalRepayableMinor, termCount, startDate, dueDay }) {
  const total = Number(totalRepayableMinor);
  const terms = Number(termCount);
  if (!Number.isInteger(total) || total <= 0) throw new Error('分期总额无效');
  if (!Number.isInteger(terms) || terms < 1) throw new Error('分期期数无效');
  const perTerm = Math.floor(total / terms);
  if (perTerm <= 0) throw new Error('每期金额必须大于零');
  const startPeriod = periodKeyOf(startDate);
  return Array.from({ length: terms }, (_, index) => {
    const periodKey = addMonths(startPeriod, index);
    const amountDueMinor = index === terms - 1 ? total - perTerm * (terms - 1) : perTerm;
    return { termNumber: index + 1, periodKey, dueDate: dueDateFor(periodKey, dueDay), amountDueMinor };
  });
}

export function nextMonthlyPeriod(plan, generatedPeriods) {
  const startPeriod = periodKeyOf(plan.startDate);
  const floor = plan.resumeFromPeriod && comparePeriods(plan.resumeFromPeriod, startPeriod) > 0 ? plan.resumeFromPeriod : startPeriod;
  let candidate = floor;
  const generated = new Set(generatedPeriods);
  while (generated.has(candidate)) candidate = addMonths(candidate, 1);
  if (plan.endDate && comparePeriods(candidate, periodKeyOf(plan.endDate)) > 0) return null;
  return candidate;
}
