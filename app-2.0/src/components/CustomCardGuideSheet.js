import { escapeHTML } from '../app/format.js';
import { createClipboardAdapter } from '../domain/paymentHandoff.js';
import { CUSTOM_CARD_CHATGPT_PROMPT, CUSTOM_CARD_GUIDE_SAFETY, CUSTOM_CARD_GUIDE_STEPS } from '../domain/customCardGuide.js';
import { openSheet, toast } from './AppSheet.js';

export async function copyCustomCardGuidePrompt({ clipboard = createClipboardAdapter(), notify = toast } = {}) {
  const result = await clipboard.writeText(CUSTOM_CARD_CHATGPT_PROMPT);
  if (result.ok) notify('已复制，可前往 ChatGPT 使用');
  else notify('无法复制，请稍后再试');
  return result;
}

export function customCardGuideHTML() {
  return `<div class="custom-card-guide" data-custom-card-guide>
    <p>你可以使用银行官网公开展示的卡片图片，再让 ChatGPT 帮你整理成适合 RinggitMe 使用的干净卡面。</p>
    <ol>${CUSTOM_CARD_GUIDE_STEPS.map((step) => `<li>${escapeHTML(step)}</li>`).join('')}</ol>
    <aside class="custom-card-guide-safety"><strong>安全提醒</strong><p>${escapeHTML(CUSTOM_CARD_GUIDE_SAFETY)}</p></aside>
    <button type="button" class="sheet-primary custom-card-guide-copy" data-custom-card-guide-copy>复制 ChatGPT 提示词</button>
  </div>`;
}

export function openCustomCardGuide({ stacked = true } = {}) {
  return openSheet({
    title: '如何制作自定义卡面',
    className: 'custom-card-guide-sheet',
    detent: 'large',
    stacked,
    contentHTML: customCardGuideHTML(),
    onOpen(sheet) {
      sheet.querySelector('[data-custom-card-guide-copy]')?.addEventListener('click', () => copyCustomCardGuidePrompt());
    },
  });
}
