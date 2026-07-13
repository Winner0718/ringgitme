import { fmtTimeAMPM, parseTimeAMPM } from '../app/format.js';
import { escapeHTML } from '../app/format.js';

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

export function timePickerHTML(value) {
  const parts = timePartsFrom24(value);
  const options = (count, start, selected) => Array.from({ length: count }, (_, index) => index + start)
    .map((number) => `<option value="${number}" ${number === selected ? 'selected' : ''}>${String(number).padStart(2, '0')}</option>`).join('');
  return `<div class="time-picker-layer" role="presentation">
    <button class="time-picker-scrim" data-time-cancel aria-label="取消选择时间"></button>
    <section class="time-picker-sheet glass-sheet" role="dialog" aria-modal="true" aria-label="选择时间">
      <div class="time-picker-grabber"><span></span></div>
      <header class="time-picker-title">选择时间</header>
      <div class="time-picker-preview num" data-time-preview>${escapeHTML(fmtTimeAMPM(value))}</div>
      <div class="time-picker-columns">
        <label><span class="caption">小时</span><select data-time-hour aria-label="小时">${options(12, 1, parts.hour)}</select></label>
        <span class="time-picker-colon" aria-hidden="true">:</span>
        <label><span class="caption">分钟</span><select data-time-minute aria-label="分钟">${options(60, 0, parts.minute)}</select></label>
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

export function openTimePickerSheet({ value, onComplete, now = () => new Date() }) {
  document.querySelector('.time-picker-layer')?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = timePickerHTML(value);
  const layer = wrapper.firstElementChild;
  document.getElementById('app').appendChild(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  const hour = layer.querySelector('[data-time-hour]');
  const minute = layer.querySelector('[data-time-minute]');
  let period = timePartsFrom24(value).period;
  let completed = false;

  const selectedValue = () => time24FromParts({ hour: hour.value, minute: minute.value, period });
  const refresh = () => {
    layer.querySelector('[data-time-preview]').textContent = fmtTimeAMPM(selectedValue());
    layer.querySelectorAll('[data-time-period]').forEach((button) => {
      const active = button.dataset.timePeriod === period;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
  };
  const close = () => {
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 220);
  };
  layer.querySelectorAll('[data-time-cancel]').forEach((button) => button.addEventListener('click', close));
  layer.querySelectorAll('[data-time-period]').forEach((button) => button.addEventListener('click', () => { period = button.dataset.timePeriod; refresh(); }));
  hour.addEventListener('change', refresh);
  minute.addEventListener('change', refresh);
  layer.querySelector('[data-time-now]').addEventListener('click', () => {
    const current = timePartsFrom24(currentLocalTime(now()));
    hour.value = String(current.hour); minute.value = String(current.minute); period = current.period; refresh();
  });
  layer.querySelector('[data-time-complete]').addEventListener('click', () => {
    if (completed) return;
    completed = true;
    onComplete?.(selectedValue());
    close();
  });
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  hour.focus();
  return { cancel: close, getValue: selectedValue };
}
