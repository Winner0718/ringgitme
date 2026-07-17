import { fmtTimeAMPM, parseTimeAMPM } from '../app/format.js';
import { registerOwnedModalHistory } from '../app/modalHistory.js';
import { isTopModal, mountModalLayer, pushModalLayer } from '../app/modalStack.js';

let activeTimePickerCancel = null;

// One custom 12-hour picker shared by Capture, Edit, relationship entries,
// obligations and settlements. Internal storage stays HH:mm. No native
// <select>: hours/minutes render as accessible scroll listboxes, so the
// control looks identical on iOS, Android and desktop, and CSS caps the
// dialog width on wide viewports.

export function timePartsFrom24(value) {
  const [rawHour, rawMinute] = String(value || '00:00').split(':').map(Number);
  const hour24 = Number.isInteger(rawHour) && rawHour >= 0 && rawHour < 24 ? rawHour : 0;
  const minute = Number.isInteger(rawMinute) && rawMinute >= 0 && rawMinute < 60 ? rawMinute : 0;
  return { hour: hour24 % 12 || 12, minute, period: hour24 >= 12 ? 'PM' : 'AM' };
}

export function time24FromParts({ hour, minute, period }) {
  const display = `${Number(hour)}:${String(Number(minute)).padStart(2, '0')} ${period}`;
  return parseTimeAMPM(display);
}

export function currentLocalTime(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function wheelOptions(count, start, selected) {
  return Array.from({ length: count }, (_, index) => index + start)
    .map((number) => `<button type="button" class="time-option${number === selected ? ' active' : ''}" data-value="${number}" role="option" aria-selected="${number === selected}">${String(number).padStart(2, '0')}</button>`)
    .join('');
}

export function timePickerHTML(value) {
  const parts = timePartsFrom24(value);
  return `<div class="time-picker-layer modal-layer" role="presentation">
    <button class="time-picker-scrim" data-time-cancel aria-label="取消选择时间"></button>
    <section class="time-picker-sheet glass-sheet" role="dialog" aria-modal="true" aria-label="选择时间">
      <div class="time-picker-grabber"><span></span></div>
      <header class="time-picker-title">选择时间</header>
      <div class="time-picker-preview num" data-time-preview>${fmtTimeAMPM(value)}</div>
      <div class="time-picker-columns">
        <div class="time-wheel-field"><span class="caption">小时</span><div class="time-wheel" data-time-hour role="listbox" aria-label="小时" tabindex="0">${wheelOptions(12, 1, parts.hour)}</div></div>
        <span class="time-picker-colon" aria-hidden="true">:</span>
        <div class="time-wheel-field"><span class="caption">分钟</span><div class="time-wheel" data-time-minute role="listbox" aria-label="分钟" tabindex="0">${wheelOptions(60, 0, parts.minute)}</div></div>
        <div class="segmented time-period" role="radiogroup" aria-label="时段">
          <button class="seg-item${parts.period === 'AM' ? ' active' : ''}" data-time-period="AM" role="radio" aria-checked="${parts.period === 'AM'}">AM</button>
          <button class="seg-item${parts.period === 'PM' ? ' active' : ''}" data-time-period="PM" role="radio" aria-checked="${parts.period === 'PM'}">PM</button>
        </div>
      </div>
      <button class="time-picker-now" data-time-now>当前时间</button>
      <div class="time-picker-actions">
        <button class="sheet-secondary" data-time-cancel>取消</button>
        <button class="sheet-primary" data-time-complete>完成</button>
      </div>
    </section>
  </div>`;
}

function bindWheel(wheel, onChange) {
  const select = (button, { scroll = true } = {}) => {
    if (!button) return;
    wheel.querySelectorAll('.time-option').forEach((option) => {
      const active = option === button;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
    });
    if (scroll) button.scrollIntoView({ block: 'center' });
    onChange();
  };
  wheel.addEventListener('click', (event) => {
    const button = event.target.closest('.time-option');
    if (button) select(button, { scroll: false });
  });
  wheel.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const options = [...wheel.querySelectorAll('.time-option')];
    const index = options.findIndex((option) => option.classList.contains('active'));
    const next = options[Math.min(options.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    select(next);
  });
  return {
    value: () => Number(wheel.querySelector('.time-option.active')?.dataset.value ?? 0),
    set: (value) => select(wheel.querySelector(`.time-option[data-value="${Number(value)}"]`)),
    centre: () => wheel.querySelector('.time-option.active')?.scrollIntoView({ block: 'center' }),
  };
}

let timePickerSequence = 0;

export function openTimePickerSheet({ value, onComplete, now = () => new Date(), trigger = document.activeElement, id = null, parentId = undefined }) {
  if (activeTimePickerCancel) {
    activeTimePickerCancel();
    return null;
  }
  const wrapper = document.createElement('div');
  wrapper.innerHTML = timePickerHTML(value);
  const layer = wrapper.firstElementChild;
  mountModalLayer(layer);
  const timePickerId = id || `time-picker:${++timePickerSequence}`;
  const releaseModal = pushModalLayer(layer, { id: timePickerId, parentId, kind: 'time-picker', trigger, surface: layer.querySelector('.time-picker-sheet'), backdrop: layer.querySelector('.time-picker-scrim') });
  requestAnimationFrame(() => layer.classList.add('open'));
  let period = timePartsFrom24(value).period;
  let completed = false;
  let closed = false;

  const refresh = () => {
    layer.querySelector('[data-time-preview]').textContent = fmtTimeAMPM(selectedValue());
    layer.querySelectorAll('[data-time-period]').forEach((button) => {
      const active = button.dataset.timePeriod === period;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
  };
  const hour = bindWheel(layer.querySelector('[data-time-hour]'), () => refresh());
  const minute = bindWheel(layer.querySelector('[data-time-minute]'), () => refresh());
  const selectedValue = () => time24FromParts({ hour: hour.value(), minute: minute.value(), period });

  const finishClose = () => {
    if (closed || !isTopModal(layer)) return false;
    closed = true;
    releaseModal(timePickerId);
    activeTimePickerCancel = null;
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 220);
    return true;
  };
  const ownedHistory = registerOwnedModalHistory({ layerId: timePickerId, isTop: () => isTopModal(layer), onPop: finishClose });
  const close = () => ownedHistory.requestClose();
  activeTimePickerCancel = close;
  const cancelButtons = layer.querySelectorAll('[data-time-cancel]');
  cancelButtons.forEach((button) => button.addEventListener('click', close));
  layer.querySelectorAll('[data-time-period]').forEach((button) => button.addEventListener('click', () => { period = button.dataset.timePeriod; refresh(); }));
  layer.querySelector('[data-time-now]').addEventListener('click', () => {
    const current = timePartsFrom24(currentLocalTime(now()));
    period = current.period;
    hour.set(current.hour);
    minute.set(current.minute);
    refresh();
  });
  layer.querySelector('[data-time-complete]').addEventListener('click', () => {
    if (completed) return;
    completed = true;
    onComplete?.(selectedValue());
    close();
  });
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Enter' && ![...cancelButtons].includes(event.target)) { event.preventDefault(); layer.querySelector('[data-time-complete]').click(); }
  });
  requestAnimationFrame(() => { hour.centre(); minute.centre(); });
  layer.querySelector('[data-time-hour]').focus();
  return { cancel: close, getValue: selectedValue };
}
