// Assets overview now uses the same native Scroll Snap foundation as category
// and detail pages. The exported name stays stable for feature wiring.
import { ui } from '../app/state.js';
import { renderCarousel, activateCarousel } from './CardCarousel.js';

export function renderStackedDeck(items) {
  const type = items[0]?.type || 'saving';
  const selectedId = ui.selectedAccountId[type];
  const index = Math.max(0, items.findIndex((account) => account.id === selectedId));
  return renderCarousel(items, index, {
    selectAction: 'assets-open-detail',
    variant: 'overview',
    carouselKey: `overview-${type}`,
  });
}

export function activateStackedDeck(container, items, onChange) {
  if (!items.length) return;
  const type = items[0].type;
  const selectedId = ui.selectedAccountId[type];
  const index = Math.max(0, items.findIndex((account) => account.id === selectedId));
  activateCarousel(container, index, onChange, { carouselKey: `overview-${type}` });
}
