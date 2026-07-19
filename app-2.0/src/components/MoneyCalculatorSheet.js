import { escapeHTML } from '../app/format.js';
import { registerOwnedModalHistory } from '../app/modalHistory.js';
import { icon } from './Icons.js';
import { isTopModal, mountModalLayer, pushModalLayer } from '../app/modalStack.js';
import { attachSheetVisualViewport } from './AppSheet.js';

const MAX_DEFAULT_MINOR = 99_999_999_99;
const PRECEDENCE = { '+': 1, '−': 1, '×': 2, '÷': 2 };
let activeCalculatorCancel = null;
let calculatorSequence = 0;

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x || 1n;
}

function fraction(n, d = 1n) {
  if (d === 0n) throw new Error('不能除以零');
  const sign = d < 0n ? -1n : 1n;
  const divisor = gcd(n, d);
  return { n: (n / divisor) * sign, d: (d / divisor) * sign };
}

function decimalFraction(token) {
  if (!/^\d+(?:\.\d{0,2})?$/.test(token)) throw new Error('金额最多保留两位小数');
  const [whole, decimal = ''] = token.split('.');
  const scale = 10n ** BigInt(decimal.length);
  return fraction(BigInt(whole) * scale + BigInt(decimal || '0'), scale);
}

export function normalizeMoneyExpression(expression) {
  return String(expression || '').replace(/\s+/g, '').replace(/-/g, '−').replace(/[xX*]/g, '×').replace(/\//g, '÷');
}

export function tokenizeMoneyExpression(expression) {
  const input = normalizeMoneyExpression(expression);
  if (!input) throw new Error('请输入金额');
  const tokens = [];
  let number = '';
  for (const char of input) {
    if (/\d|\./.test(char)) { number += char; continue; }
    if (!(char in PRECEDENCE)) throw new Error('算式包含无效字符');
    if (!number) throw new Error('算式不完整');
    tokens.push(number, char);
    number = '';
  }
  if (!number) throw new Error('算式不完整');
  tokens.push(number);
  return tokens;
}

function applyOperator(operator, left, right) {
  if (operator === '+') return fraction(left.n * right.d + right.n * left.d, left.d * right.d);
  if (operator === '−') return fraction(left.n * right.d - right.n * left.d, left.d * right.d);
  if (operator === '×') return fraction(left.n * right.n, left.d * right.d);
  if (right.n === 0n) throw new Error('不能除以零');
  return fraction(left.n * right.d, left.d * right.n);
}

export function evaluateMoneyExpression(expression, { allowZero = false, maxMinor = MAX_DEFAULT_MINOR } = {}) {
  const tokens = tokenizeMoneyExpression(expression);
  const values = [];
  const operators = [];
  const reduce = () => {
    const right = values.pop();
    const left = values.pop();
    if (!left || !right) throw new Error('算式不完整');
    values.push(applyOperator(operators.pop(), left, right));
  };
  tokens.forEach((token, index) => {
    if (index % 2 === 0) values.push(decimalFraction(token));
    else {
      while (operators.length && PRECEDENCE[operators.at(-1)] >= PRECEDENCE[token]) reduce();
      operators.push(token);
    }
  });
  while (operators.length) reduce();
  const result = values[0];
  if (!result || result.n < 0n) throw new Error('金额不能为负数');
  const scaled = result.n * 100n;
  const minor = Number((scaled + result.d / 2n) / result.d);
  if (!allowZero && minor === 0) throw new Error('金额必须大于零');
  if (!Number.isSafeInteger(minor) || minor > maxMinor) throw new Error('金额超过可用上限');
  return { minor, value: (minor / 100).toFixed(2), expression: normalizeMoneyExpression(expression) };
}

export function moneyStringToMinor(value) {
  return evaluateMoneyExpression(String(value ?? ''), { allowZero: true }).minor;
}

export function formatMoneyMinor(minor) {
  return `RM ${(Number(minor || 0) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function inspectMoneyExpression(expression, options = {}) {
  const normalized = normalizeMoneyExpression(expression);
  if (!normalized) return { expression: '', result: null, currentMinor: 0, error: '请输入金额', helper: '输入金额或算式' };
  try {
    return { expression: normalized, result: evaluateMoneyExpression(normalized, options), currentMinor: null, error: '', helper: '' };
  } catch (reason) {
    let currentMinor = 0;
    if (/[+−×÷]$/.test(normalized)) {
      try { currentMinor = evaluateMoneyExpression(normalized.slice(0, -1), { ...options, allowZero: true }).minor; } catch { currentMinor = 0; }
      return { expression: normalized, result: null, currentMinor, error: reason.message, helper: '继续输入数字' };
    }
    return { expression: normalized, result: null, currentMinor, error: reason.message, helper: reason.message };
  }
}

export function moneyFieldHTML({ label, key, value, caption = '' }) {
  let minor = 0;
  try { minor = moneyStringToMinor(value || '0'); } catch { minor = 0; }
  return `<div class="cap-field money-field"><span class="caption">${escapeHTML(label)}</span><button type="button" class="money-field-button" data-money-field="${escapeHTML(key)}" aria-label="${escapeHTML(label)}，当前 ${formatMoneyMinor(minor)}"><span class="num" data-money-field-label="${escapeHTML(key)}">${formatMoneyMinor(minor)}</span>${icon('chevronRight', 15)}</button>${caption ? `<small class="caption">${escapeHTML(caption)}</small>` : ''}<input type="hidden" data-money-value="${escapeHTML(key)}" value="${escapeHTML(String(value || ''))}" /></div>`;
}

function calculatorHTML(expression, options) {
  const state = inspectMoneyExpression(expression, options);
  const keys = ['C','back','÷','×','7','8','9','−','4','5','6','+','1','2','3','=','0','.','apply'];
  return `<button class="calculator-scrim" data-modal-backdrop data-calculator-cancel aria-label="取消金额计算"></button>
    <section class="calculator-sheet glass-sheet" data-sheet-detent="medium" data-modal-surface role="dialog" aria-modal="true" aria-label="金额计算器" tabindex="-1">
      <div class="time-picker-grabber"><span></span></div><header class="time-picker-title">金额计算器</header>
      <div class="calculator-display${state.error ? ' has-error' : ''}" data-calculator-display>
        <span class="caption calculator-display-label">算式</span><div class="calculator-expression num" data-calculator-expression>${escapeHTML(state.expression || '0')}</div>
        <span class="caption calculator-display-label">${state.result ? '结果' : '当前金额'}</span><div class="num calculator-result" data-calculator-result>${formatMoneyMinor(state.result?.minor ?? state.currentMinor)}</div>
        <div class="caption calculator-helper${state.error ? ' error' : ''}" data-calculator-error>${escapeHTML(state.helper)}</div>
      </div>
      <div class="calculator-keypad rm-calculator" data-rm-component="Calculator" role="group" aria-label="计算器键盘">${keys.map((key) => `<button type="button" class="calculator-key rm-calculator-key${['÷','×','−','+','='].includes(key) ? ' operator' : ''}${key === '0' ? ' zero' : ''}${key === 'apply' ? ' apply' : ''}" ${key === 'apply' ? 'data-calculator-apply' : `data-calculator-key="${key}"`} aria-label="${key === 'back' ? '退格' : key === 'C' ? '清除' : key === 'apply' ? '应用金额' : key}">${key === 'back' ? icon('backspace', 19) : key === 'apply' ? '应用' : key}</button>`).join('')}</div>
      <button type="button" class="calculator-cancel" data-calculator-cancel>取消</button>
    </section>`;
}

export function moneyCalculatorHTML(value, options = {}) {
  return `<div class="calculator-layer" data-sheet-detent="medium" role="presentation">${calculatorHTML(String(value || ''), options)}</div>`;
}

export function openMoneyCalculatorSheet({ value = '', allowZero = false, maxMinor = MAX_DEFAULT_MINOR, onComplete, trigger = document.activeElement, id = null, parentId = undefined }) {
  if (activeCalculatorCancel && !activeCalculatorCancel()) return null;
  if (activeCalculatorCancel) return null;
  const layer = document.createElement('div');
  layer.className = 'calculator-layer modal-layer';
  let expression = String(value || '');
  let fresh = Boolean(expression);
  let completed = false;
  const options = { allowZero, maxMinor };
  const render = () => { layer.innerHTML = calculatorHTML(expression, options); };
  const emphasizeError = () => {
    const display = layer.querySelector('[data-calculator-display]');
    display?.classList.remove('error-shake');
    void display?.offsetWidth;
    display?.classList.add('error-shake', 'error-emphasis');
    display?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };
  let releaseModal = () => {};
  const calculatorId = id || `money-calculator:${++calculatorSequence}`;
  let closed = false;
  let ownedHistory = null;
  let viewportCleanup = () => {};
  const finishClose = () => {
    if (closed) return false;
    if (!isTopModal(layer)) return false;
    closed = true;
    releaseModal(calculatorId);
    viewportCleanup();
    activeCalculatorCancel = null;
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 220);
    return true;
  };
  const close = () => ownedHistory?.requestClose() || false;
  activeCalculatorCancel = close;
  const append = (key) => {
    if (key === 'C') { expression = ''; fresh = false; return render(); }
    if (key === 'back') { expression = expression.slice(0, -1); fresh = false; return render(); }
    if (key === '=') {
      try { expression = evaluateMoneyExpression(expression, options).value; fresh = true; } catch { /* the inline error already explains why */ }
      return render();
    }
    const operator = ['+','−','×','÷'].includes(key);
    if (operator) {
      fresh = false;
      if (!expression || /[+−×÷]$/.test(expression)) return;
      expression += key;
      return render();
    }
    if (fresh) { expression = ''; fresh = false; }
    const tail = expression.split(/[+−×÷]/).at(-1) || '';
    if (key === '.' && tail.includes('.')) return;
    if (tail.includes('.') && tail.split('.')[1].length >= 2) return;
    expression += key;
    render();
  };
  render();
  const surface = layer.querySelector('.calculator-sheet');
  const backdrop = layer.querySelector('.calculator-scrim');
  surface?.setAttribute('data-modal-surface', '');
  backdrop?.setAttribute('data-modal-backdrop', '');
  mountModalLayer(layer);
  layer.dataset.sheetDetent = 'medium';
  viewportCleanup = attachSheetVisualViewport(layer);
  releaseModal = pushModalLayer(layer, { id: calculatorId, parentId, kind: 'calculator', trigger, surface, backdrop });
  ownedHistory = registerOwnedModalHistory({ layerId: calculatorId, isTop: () => isTopModal(layer), onPop: finishClose });
  requestAnimationFrame(() => layer.classList.add('open'));
  layer.addEventListener('click', (event) => {
    if (!isTopModal(layer)) return;
    if (event.target.closest('[data-calculator-cancel]')) { event.stopPropagation(); return close(); }
    const key = event.target.closest('[data-calculator-key]');
    if (key) return append(key.dataset.calculatorKey);
    if (event.target.closest('[data-calculator-apply]')) {
      if (completed) return;
      try {
        const result = evaluateMoneyExpression(expression, options);
        completed = true;
        onComplete?.(result.value, result);
        close();
      } catch { emphasizeError(); }
    }
  });
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isTopModal(layer)) { event.preventDefault(); event.stopPropagation(); return close(); }
    if (event.key === 'Enter') { event.preventDefault(); return layer.querySelector('[data-calculator-apply]')?.click(); }
    const mapped = event.key === 'Backspace' ? 'back' : event.key === 'Delete' ? 'C' : event.key;
    if (/^[0-9.]$/.test(mapped) || ['+','-','*','/','back','C'].includes(mapped)) { event.preventDefault(); append(normalizeMoneyExpression(mapped)); }
  });
  layer.querySelector('.calculator-sheet')?.focus?.();
  return { cancel: close, getExpression: () => expression };
}

export function bindMoneyField(root, key, { getValue, setValue, allowZero = false, maxMinor = MAX_DEFAULT_MINOR, onApplied } = {}) {
  const button = root?.querySelector(`[data-money-field="${key}"]`);
  if (!button) return () => {};
  const open = () => openMoneyCalculatorSheet({ value: getValue?.() ?? root.querySelector(`[data-money-value="${key}"]`)?.value ?? '', allowZero, maxMinor, trigger: button, onComplete: (value, result) => {
    const input = root.querySelector(`[data-money-value="${key}"]`);
    const label = root.querySelector(`[data-money-field-label="${key}"]`);
    if (input) input.value = value;
    if (label) label.textContent = formatMoneyMinor(result.minor);
    const fieldLabel = button.dataset.moneyLabel || button.closest('.cap-field')?.querySelector('.caption')?.textContent || '金额';
    button.setAttribute('aria-label', `${fieldLabel}，当前 ${formatMoneyMinor(result.minor)}`);
    setValue?.(value, result);
    onApplied?.(value, result);
  } });
  button.addEventListener('click', open);
  return () => button.removeEventListener('click', open);
}
