import { fmtDateMY } from '../app/format.js';
import { prefersReducedMotion } from '../app/motion.js';
import { pushModalLayer } from '../app/modalStack.js';

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export function isISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

export function isoFromParts(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dateParts(value) {
  if (!isISODate(value)) throw new Error('日期无效');
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

export function shiftMonth({ year, month }, delta) {
  const index = year * 12 + (month - 1) + Number(delta);
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 + 1 };
}

export function shiftDate(value, days) {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + Number(days)));
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function clampDateToMonth(value, year, month) {
  const day = isISODate(value) ? dateParts(value).day : 1;
  return isoFromParts(year, month, Math.min(day, daysInMonth(year, month)));
}

export function calendarCells(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const first = new Date(Date.UTC(year, month - 1, 1 - firstWeekday));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    return {
      iso: isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() + 1 === month,
    };
  });
}

function localISO(now = new Date()) {
  return isoFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function monthPanelHTML(year, month, selected, today, current = false) {
  const cells = calendarCells(year, month);
  return `<div class="date-month-panel${current ? ' current' : ''}" data-month-panel="${year}-${month}"><div class="date-weekdays" aria-hidden="true">${['日','一','二','三','四','五','六'].map((day) => `<span>${day}</span>`).join('')}</div>
    <div class="date-calendar" role="grid" aria-label="${year}年${month}月" ${current ? 'tabindex="0"' : 'aria-hidden="true"'}>${cells.map((cell) => `<button type="button" class="date-day${cell.inMonth ? '' : ' outside'}${cell.iso === selected ? ' selected' : ''}${cell.iso === today ? ' today' : ''}" data-date-value="${cell.iso}" role="gridcell" aria-selected="${cell.iso === selected}" aria-label="${fmtDateMY(cell.iso)}${cell.iso === today ? '，今天' : ''}">${cell.day}</button>`).join('')}</div></div>`;
}

function calendarHTML({ selected, today, viewYear, viewMonth, chooser }) {
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const previous = shiftMonth({ year: viewYear, month: viewMonth }, -1);
  const next = shiftMonth({ year: viewYear, month: viewMonth }, 1);
  return `<button class="date-picker-scrim" data-date-cancel aria-label="取消选择日期"></button>
    <section class="date-picker-sheet glass-sheet" role="dialog" aria-modal="true" aria-label="选择日期">
      <div class="time-picker-grabber"><span></span></div>
      <header class="time-picker-title">选择日期</header>
      <div class="date-picker-nav">
        <button type="button" data-date-prev aria-label="上个月">‹</button>
        <button type="button" class="date-picker-month-title" data-date-chooser aria-expanded="${chooser}">${viewYear}年${viewMonth}月</button>
        <button type="button" data-date-next aria-label="下个月">›</button>
      </div>
      ${chooser ? `<div class="date-month-chooser" aria-label="选择月份和年份">
        <div class="date-year-step"><button type="button" data-date-year-step="-1" aria-label="上一年">‹</button><strong class="num">${viewYear}</strong><button type="button" data-date-year-step="1" aria-label="下一年">›</button></div>
        <div class="date-month-grid">${months.map((month) => `<button type="button" class="${month === viewMonth ? 'active' : ''}" data-date-month="${month}">${month}月</button>`).join('')}</div>
      </div>` : `<div class="date-month-window" data-date-month-window><div class="date-month-track" data-date-month-track>
        ${monthPanelHTML(previous.year, previous.month, selected, today)}${monthPanelHTML(viewYear, viewMonth, selected, today, true)}${monthPanelHTML(next.year, next.month, selected, today)}
      </div></div>`}
      <div class="date-picker-preview caption">已选择 <strong>${fmtDateMY(selected)}</strong></div>
      <div class="date-picker-footer">
        <button type="button" class="date-picker-today" data-date-today>今天</button>
        <div class="date-picker-actions"><button type="button" class="sheet-secondary" data-date-cancel>取消</button><button type="button" class="sheet-primary" data-date-complete>完成</button></div>
      </div>
    </section>`;
}

export function datePickerHTML(value, { today = localISO(), chooser = false } = {}) {
  const selected = isISODate(value) ? value : today;
  const { year, month } = dateParts(selected);
  return `<div class="date-picker-layer" role="presentation">${calendarHTML({ selected, today, viewYear: year, viewMonth: month, chooser })}</div>`;
}

export function openDatePickerSheet({ value, onComplete, today = () => localISO() }) {
  document.querySelector('.date-picker-layer')?.remove();
  const todayValue = today();
  let selected = isISODate(value) ? value : todayValue;
  let { year: viewYear, month: viewMonth } = dateParts(selected);
  let chooser = false;
  let completed = false;
  let pointer = null;
  let transitionTimer = null;
  const layer = document.createElement('div');
  layer.className = 'date-picker-layer';
  let releaseModal = () => {};

  const render = () => {
    layer.innerHTML = calendarHTML({ selected, today: todayValue, viewYear, viewMonth, chooser });
    const debugDrag = typeof window === 'undefined' ? NaN : Number(new URLSearchParams(window.location.search).get('dateDrag'));
    if (!chooser && Number.isFinite(debugDrag) && Math.abs(debugDrag) <= 1) {
      // Screenshot-only pause point for a genuine prepared adjacent-month
      // track. It is inert unless an internal query parameter is supplied.
      const track = layer.querySelector('[data-date-month-track]');
      if (track) track.style.transform = `translate3d(${(-33.3333 - debugDrag * 33.3333).toFixed(4)}%,0,0)`;
    }
  };
  const showSelectedMonth = () => {
    const parts = dateParts(selected);
    viewYear = parts.year;
    viewMonth = parts.month;
  };
  const moveView = (delta, { animate = true } = {}) => {
    const next = shiftMonth({ year: viewYear, month: viewMonth }, delta);
    if (next.year < MIN_YEAR || next.year > MAX_YEAR) return;
    const commit = () => { viewYear = next.year; viewMonth = next.month; render(); };
    const track = layer.querySelector('[data-date-month-track]');
    if (!animate || prefersReducedMotion() || !track) return commit();
    clearTimeout(transitionTimer);
    track.classList.add('settling');
    track.style.transform = `translate3d(${delta > 0 ? '-66.6667%' : '0%'},0,0)`;
    layer.querySelector('.date-picker-month-title')?.classList.add(delta > 0 ? 'to-next' : 'to-prev');
    transitionTimer = setTimeout(commit, 230);
  };
  const close = () => {
    clearTimeout(transitionTimer);
    releaseModal();
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 220);
  };
  const choose = (iso) => {
    if (!isISODate(iso)) return;
    selected = iso;
    showSelectedMonth();
    chooser = false;
    render();
  };

  render();
  document.getElementById('app').appendChild(layer);
  releaseModal = pushModalLayer(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  layer.addEventListener('click', (event) => {
    if (event.target.closest('[data-date-cancel]')) return close();
    if (event.target.closest('[data-date-complete]')) {
      if (completed) return;
      completed = true;
      onComplete?.(selected);
      return close();
    }
    if (event.target.closest('[data-date-prev]')) return moveView(-1);
    if (event.target.closest('[data-date-next]')) return moveView(1);
    if (event.target.closest('[data-date-chooser]')) { chooser = !chooser; render(); return; }
    const yearStep = event.target.closest('[data-date-year-step]');
    if (yearStep) {
      viewYear = Math.min(MAX_YEAR, Math.max(MIN_YEAR, viewYear + Number(yearStep.dataset.dateYearStep)));
      render(); return;
    }
    const month = event.target.closest('[data-date-month]');
    if (month) { viewMonth = Number(month.dataset.dateMonth); chooser = false; selected = clampDateToMonth(selected, viewYear, viewMonth); render(); return; }
    const day = event.target.closest('[data-date-value]');
    if (day) return choose(day.dataset.dateValue);
    if (event.target.closest('[data-date-today]')) return choose(todayValue);
  });
  layer.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) { event.preventDefault(); selected = shiftDate(selected, moves[event.key]); showSelectedMonth(); render(); return; }
    if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); const next = shiftMonth(dateParts(selected), event.key === 'PageDown' ? 1 : -1); selected = clampDateToMonth(selected, next.year, next.month); showSelectedMonth(); render(); return; }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Enter') { event.preventDefault(); layer.querySelector('[data-date-complete]')?.click(); }
  });
  layer.addEventListener('pointerdown', (event) => {
    const windowEl = event.target.closest('[data-date-month-window]');
    if (!windowEl || chooser || !event.isPrimary) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: null };
  });
  layer.addEventListener('pointermove', (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (pointer.horizontal === null && Math.hypot(dx, dy) > 7) pointer.horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
    if (!pointer.horizontal) return;
    event.preventDefault();
    pointer.dx = dx;
    const track = layer.querySelector('[data-date-month-track]');
    if (track) track.style.transform = `translate3d(calc(-33.3333% + ${dx}px),0,0)`;
  });
  const finishDrag = (event, cancelled = false) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { dx, horizontal } = pointer;
    pointer = null;
    if (cancelled || !horizontal || Math.abs(dx) < 38) {
      const track = layer.querySelector('[data-date-month-track]');
      if (track) { track.classList.add('settling'); track.style.transform = 'translate3d(-33.3333%,0,0)'; }
      return;
    }
    moveView(dx < 0 ? 1 : -1);
  };
  layer.addEventListener('pointerup', (event) => finishDrag(event));
  layer.addEventListener('pointercancel', (event) => finishDrag(event, true));
  layer.querySelector('.date-calendar')?.focus();
  return { cancel: close, getValue: () => selected };
}
