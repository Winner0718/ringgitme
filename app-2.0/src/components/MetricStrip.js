// ============================================================
// MetricStrip — compact horizontal money-picture strip (≤64px
// tall, 3–4 tiles visible, horizontally scrollable). Carries
// the full blueprint §14.1 metric set. Never a wall of cards.
// ============================================================

import { fmtRM } from '../app/format.js';
import { ui } from '../app/state.js';

const METRICS = [
  { id: 'myFixed', label: '我的固定', hint: '我的月固定份额' },
  { id: 'totalCardDebt', label: '信用卡总欠', negative: true },
  { id: 'monthCardDue', label: '本月卡+分期应还', negative: true },
  { id: 'afterCardPayment', label: '还卡后 Cash' },
  { id: 'aaReceivable', label: 'AA 待收', positive: true },
  { id: 'afterReceive', label: '收回后 Cash' },
];

export function renderMetricStrip(pulse) {
  return `
    <section class="metric-strip section" aria-label="钱况指标">
      <div class="metric-scroll">
        ${METRICS.map((m) => {
          const v = pulse[m.id];
          const cls = m.negative && v > 0 ? 'amt-neg' : m.positive && v > 0 ? 'amt-pos' : '';
          return `<button class="metric-tile surface" data-action="metric-tap" data-metric="${m.id}">
            <span class="caption">${m.label}</span>
            <span class="num metric-val ${cls}">${fmtRM(v, { privacy: ui.privacy })}</span>
          </button>`;
        }).join('')}
      </div>
    </section>
  `;
}
