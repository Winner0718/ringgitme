// Turns a natural finger tap into one activation without confusing a scroll
// gesture (or the synthetic click that mobile browsers emit afterwards).
export function tapMovementWithinThreshold(startX, startY, endX, endY, threshold = 8) {
  return Math.hypot(endX - startX, endY - startY) <= threshold;
}

export function bindTapIntent(element, activate, { threshold = 8 } = {}) {
  if (!element) return () => {};
  let tracking = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let suppressClickUntil = 0;

  const begin = (x, y) => {
    tracking = true;
    moved = false;
    startX = x;
    startY = y;
  };
  const move = (x, y) => {
    if (tracking && !tapMovementWithinThreshold(startX, startY, x, y, threshold)) moved = true;
  };
  const end = (event) => {
    if (!tracking) return;
    tracking = false;
    suppressClickUntil = Date.now() + 700;
    if (!moved) activate(event);
  };
  const cancel = () => { tracking = false; moved = true; };

  const pointerDown = (event) => begin(event.clientX, event.clientY);
  const pointerMove = (event) => move(event.clientX, event.clientY);
  const pointerUp = (event) => end(event);
  const touchStart = (event) => { const touch = event.changedTouches[0]; begin(touch.clientX, touch.clientY); };
  const touchMove = (event) => { const touch = event.changedTouches[0]; move(touch.clientX, touch.clientY); };
  const touchEnd = (event) => end(event);
  const click = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (Date.now() > suppressClickUntil) activate(event);
  };

  if (window.PointerEvent) {
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointermove', pointerMove);
    element.addEventListener('pointerup', pointerUp);
    element.addEventListener('pointercancel', cancel);
  } else {
    element.addEventListener('touchstart', touchStart, { passive: true });
    element.addEventListener('touchmove', touchMove, { passive: true });
    element.addEventListener('touchend', touchEnd);
    element.addEventListener('touchcancel', cancel);
  }
  element.addEventListener('click', click, true);

  return () => {
    element.removeEventListener('pointerdown', pointerDown);
    element.removeEventListener('pointermove', pointerMove);
    element.removeEventListener('pointerup', pointerUp);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('touchstart', touchStart);
    element.removeEventListener('touchmove', touchMove);
    element.removeEventListener('touchend', touchEnd);
    element.removeEventListener('touchcancel', cancel);
    element.removeEventListener('click', click, true);
  };
}
