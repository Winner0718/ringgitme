import { fmtDateMY, fmtTimeAMPM, escapeHTML } from '../app/format.js';
import { icon } from './Icons.js';
import { openTimePickerSheet } from './TimePickerSheet.js';

export function nativeDateTimeFieldsHTML({ prefix, date, time }) {
  return `<div class="cap-datetime" data-native-datetime="${escapeHTML(prefix)}">
    <div class="cap-field"><span class="caption">日期</span>
      <div class="native-picker-wrap">
        <button type="button" class="native-picker-display" data-native-picker-trigger="date" aria-readonly="true" aria-label="选择日期，当前 ${fmtDateMY(date)}"><span data-native-picker-label="date">${fmtDateMY(date)}</span>${icon('calendar', 16)}</button>
        <input class="native-picker-input" type="date" value="${escapeHTML(date)}" data-native-picker-input="date" tabindex="-1" aria-label="系统日期选择器" />
      </div>
    </div>
    <div class="cap-field"><span class="caption">时间</span>
      <div class="native-picker-wrap">
        <button type="button" class="native-picker-display" data-ringgit-time-trigger aria-readonly="true" aria-label="选择时间，当前 ${fmtTimeAMPM(time)}"><span data-ringgit-time-label>${fmtTimeAMPM(time)}</span>${icon('clock', 16)}</button>
        <input type="hidden" value="${escapeHTML(time)}" data-ringgit-time-input />
      </div>
    </div>
  </div>`;
}

export function openNativePicker(input) {
  if (!input) return 'missing';
  try {
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return 'showPicker';
    }
  } catch {
    // Some engines expose showPicker but reject it outside a user gesture.
  }
  input.focus?.();
  input.click?.();
  return 'focus-click';
}

export function bindNativeDateTimeFields(root, { onDateChange, onTimeChange } = {}) {
  if (!root) return () => {};
  const cleanups = [];
  ['date'].forEach((kind) => {
    const input = root.querySelector(`[data-native-picker-input="${kind}"]`);
    const trigger = root.querySelector(`[data-native-picker-trigger="${kind}"]`);
    const label = root.querySelector(`[data-native-picker-label="${kind}"]`);
    if (!input || !trigger || !label) return;
    const open = () => openNativePicker(input);
    const change = () => {
      if (!input.value) return;
      label.textContent = kind === 'date' ? fmtDateMY(input.value) : fmtTimeAMPM(input.value);
      trigger.setAttribute('aria-label', `${kind === 'date' ? '选择日期' : '选择时间'}，当前 ${label.textContent}`);
      if (kind === 'date') onDateChange?.(input.value);
      else onTimeChange?.(input.value);
    };
    trigger.addEventListener('click', open);
    input.addEventListener('change', change);
    cleanups.push(() => { trigger.removeEventListener('click', open); input.removeEventListener('change', change); });
  });
  const timeInput = root.querySelector('[data-ringgit-time-input]');
  const timeTrigger = root.querySelector('[data-ringgit-time-trigger]');
  const timeLabel = root.querySelector('[data-ringgit-time-label]');
  if (timeInput && timeTrigger && timeLabel) {
    const open = () => openTimePickerSheet({ value: timeInput.value, onComplete: (value) => {
      timeInput.value = value;
      timeLabel.textContent = fmtTimeAMPM(value);
      timeTrigger.setAttribute('aria-label', `选择时间，当前 ${timeLabel.textContent}`);
      onTimeChange?.(value);
    } });
    timeTrigger.addEventListener('click', open);
    cleanups.push(() => timeTrigger.removeEventListener('click', open));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
