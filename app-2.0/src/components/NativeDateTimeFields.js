import { fmtDateMY, fmtTimeAMPM, escapeHTML } from '../app/format.js';
import { icon } from './Icons.js';
import { openDatePickerSheet } from './DatePickerSheet.js';
import { openTimePickerSheet } from './TimePickerSheet.js';

export function datePickerFieldHTML({ label = '日期', key = 'date', value = '', emptyLabel = '选择日期', inputName = null }) {
  const visible = value ? fmtDateMY(value) : emptyLabel;
  return `<div class="cap-field"><span class="caption">${escapeHTML(label)}</span>
    <div class="native-picker-wrap">
      <button type="button" class="native-picker-display" data-ringgit-date-trigger="${escapeHTML(key)}" aria-readonly="true" aria-label="${escapeHTML(label)}，当前 ${escapeHTML(visible)}"><span data-ringgit-date-label="${escapeHTML(key)}">${escapeHTML(visible)}</span>${icon('calendar', 16)}</button>
      <input type="hidden" ${inputName ? `name="${escapeHTML(inputName)}" ` : ''}value="${escapeHTML(value)}" data-ringgit-date-input="${escapeHTML(key)}" />
    </div>
  </div>`;
}

export function nativeDateTimeFieldsHTML({ prefix, date, time, dateLabel = '日期', timeLabel = '时间' }) {
  return `<div class="cap-datetime rm-native-datetime" data-rm-component="NativeDateTimeField" data-native-datetime="${escapeHTML(prefix)}">
    ${datePickerFieldHTML({ label: dateLabel, key: 'date', value: date })}
    <div class="cap-field"><span class="caption">${escapeHTML(timeLabel)}</span>
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
  const prefix = root.querySelector('[data-native-datetime]')?.dataset.nativeDatetime;
  if (prefix) cleanups.push(bindDatePickerField(root, 'date', { onDateChange }));
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

export function bindDatePickerField(root, key, { onDateChange } = {}) {
  const input = root?.querySelector(`[data-ringgit-date-input="${key}"]`);
  const trigger = root?.querySelector(`[data-ringgit-date-trigger="${key}"]`);
  const label = root?.querySelector(`[data-ringgit-date-label="${key}"]`);
  if (!input || !trigger || !label) return () => {};
  const open = () => openDatePickerSheet({ value: input.value, onComplete: (value) => {
    input.value = value;
    label.textContent = fmtDateMY(value);
    trigger.setAttribute('aria-label', `${trigger.closest('.cap-field')?.querySelector('.caption')?.textContent || '日期'}，当前 ${label.textContent}`);
    onDateChange?.(value);
  } });
  trigger.addEventListener('click', open);
  return () => trigger.removeEventListener('click', open);
}
