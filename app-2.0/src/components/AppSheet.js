// ============================================================
// AppSheet — bottom-sheet manager (G2 glass surface).
// One sheet at a time, scrim tap / grabber drag / Esc to close,
// keyboard-safe (max-height leaves room), reduced-motion aware.
// ============================================================

let host = null;
let activeSheet = null;

export function mountSheetHost(parent) {
  host = document.createElement('div');
  host.className = 'sheet-host';
  parent.appendChild(host);
}

export function openSheet({ title, contentHTML, className = '', onClose, onOpen }) {
  closeSheet(true);
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  const sheet = document.createElement('section');
  sheet.className = `sheet glass-sheet ${className}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  if (title) sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `
    <div class="sheet-grabber" data-action="sheet-close-drag"><span></span></div>
    ${title ? `<header class="sheet-title">${title}</header>` : ''}
    <div class="sheet-body">${contentHTML}</div>
  `;
  host.appendChild(scrim);
  host.appendChild(sheet);
  activeSheet = { scrim, sheet, onClose };

  requestAnimationFrame(() => {
    scrim.classList.add('open');
    sheet.classList.add('open');
  });

  scrim.addEventListener('click', () => closeSheet());
  attachDragToClose(sheet);
  document.addEventListener('keydown', escHandler);
  if (onOpen) onOpen(sheet);
  return sheet;
}

function escHandler(e) {
  if (e.key === 'Escape') closeSheet();
}

export function closeSheet(instant = false) {
  if (!activeSheet) return;
  const { scrim, sheet, onClose } = activeSheet;
  activeSheet = null;
  document.removeEventListener('keydown', escHandler);
  if (onClose) onClose();
  if (instant) {
    scrim.remove();
    sheet.remove();
    return;
  }
  scrim.classList.remove('open');
  sheet.classList.remove('open');
  setTimeout(() => {
    scrim.remove();
    sheet.remove();
  }, 300);
}

export function isSheetOpen() {
  return !!activeSheet;
}

// Drag the grabber (or sheet header area) downward to dismiss
function attachDragToClose(sheet) {
  const grabber = sheet.querySelector('.sheet-grabber');
  if (!grabber) return;
  let startY = 0;
  let delta = 0;
  let dragging = false;

  grabber.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    delta = 0;
    sheet.style.transition = 'none';
    grabber.setPointerCapture(e.pointerId);
  });
  grabber.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    delta = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${delta}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    if (delta > 90) {
      sheet.style.transform = '';
      closeSheet();
    } else {
      sheet.style.transform = '';
    }
  };
  grabber.addEventListener('pointerup', end);
  grabber.addEventListener('pointercancel', end);
}

// Success toast (top G2 capsule per blueprint §15.2)
let toastTimer = null;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast glass-sheet';
    document.getElementById('app').appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
