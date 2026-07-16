// Compatibility facade. All account/card carousel contexts now share the
// browser-native Scroll Snap implementation below; no pointer-driven card
// movement remains in this module.
export {
  renderNativeSnapCardCarousel as renderCarousel,
  activateNativeSnapCardCarousel as activateCarousel,
  nearestCenterIndex,
  centeredScrollLeft,
} from './NativeSnapCardCarousel.js';

export { accountVisualCardHTML as renderCardFace } from './AccountVisualCard.js';
