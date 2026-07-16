export const CAPTURE_MODES = [
  { id: 'expense', label: '支出' }, { id: 'income', label: '收入' }, { id: 'transfer', label: '转账' },
];

export function resolveCaptureViewportHeight(visualViewport, innerHeight) {
  const measured = Number(visualViewport?.height);
  return Number.isFinite(measured) && measured > 0 ? Math.round(measured) : Math.round(Number(innerHeight) || 0);
}

export function bindCaptureViewportHeight(sheet, browserWindow = window) {
  const viewport = browserWindow.visualViewport;
  const updateHeight = () => {
    const height = resolveCaptureViewportHeight(viewport, browserWindow.innerHeight);
    if (height > 0) sheet.style.setProperty('--capture-viewport-height', `${height}px`);
  };
  viewport?.addEventListener('resize', updateHeight);
  viewport?.addEventListener('scroll', updateHeight);
  browserWindow.addEventListener('resize', updateHeight);
  browserWindow.addEventListener('orientationchange', updateHeight);
  updateHeight();
  return () => {
    viewport?.removeEventListener('resize', updateHeight);
    viewport?.removeEventListener('scroll', updateHeight);
    browserWindow.removeEventListener('resize', updateHeight);
    browserWindow.removeEventListener('orientationchange', updateHeight);
  };
}

export function syncCaptureSheetPresentation(sheet, mode) {
  sheet?.classList.toggle('capture-sheet-transfer', mode === 'transfer');
  sheet?.setAttribute('data-capture-mode', mode);
}

// Personal ledgers speak of 他/她 while group ledgers speak of 成员.
export function relationshipTypeLabels(ledger) {
  const group = ledger?.derivedType === 'group';
  return {
    normal: '普通支出',
    split_expense: 'AA 分账',
    direct_receivable: group ? '成员欠我' : '他欠我',
    direct_payable: group ? '我欠成员' : '我欠他',
  };
}
