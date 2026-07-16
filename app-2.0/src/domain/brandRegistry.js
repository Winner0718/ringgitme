const BASE = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/';

export function assetURL(path, base = BASE) {
  if (!path) return '';
  if (/^(?:data:|blob:|https?:)/.test(path)) return path;
  const cleanBase = `/${String(base || '/').replace(/^\/+|\/+$/g, '')}`.replace('//', '/');
  const prefix = cleanBase === '/' ? '/' : `${cleanBase}/`;
  return `${prefix}${String(path).replace(/^\/+/, '')}`;
}

const BRANDS = Object.freeze({
  maybank: { id: 'maybank', name: 'Maybank', type: 'bank', logo: 'assets/brands/maybank.svg', fallback: '#f5b800', aliases: ['malayan banking'] },
  cimb: { id: 'cimb', name: 'CIMB', type: 'bank', logo: 'assets/brands/cimb.svg', fallback: '#c0152c', aliases: [] },
  publicbank: { id: 'publicbank', name: 'Public Bank', type: 'bank', logo: 'assets/brands/public-bank.svg', fallback: '#a3131a', aliases: ['pbb'] },
  rhb: { id: 'rhb', name: 'RHB', type: 'bank', logo: 'assets/brands/rhb.svg', fallback: '#155ba5', aliases: [] },
  boost: { id: 'boost', name: 'Boost', type: 'ewallet', logo: 'assets/brands/boost.svg', fallback: '#e8362c', aliases: [] },
  tng: { id: 'tng', name: "Touch 'n Go", type: 'ewallet', logo: 'assets/brands/touch-n-go.svg', fallback: '#134a8e', aliases: ['tng', 'touch n go'] },
  grabpay: { id: 'grabpay', name: 'GrabPay', type: 'ewallet', logo: 'assets/brands/grabpay.svg', fallback: '#00804a', aliases: ['grab'] },
  bigpay: { id: 'bigpay', name: 'BigPay', type: 'ewallet', logo: 'assets/brands/bigpay.svg', fallback: '#12b5ab', aliases: [] },
});

export function getBrand(id) {
  const brand = BRANDS[id];
  return brand ? { ...brand, logoURL: assetURL(brand.logo) } : null;
}

export function resolveAccountBrand(account) {
  const text = `${account?.id || ''} ${account?.name || ''} ${account?.bank || ''}`.toLowerCase();
  const id = text.includes('boost') ? 'boost'
    : text.includes('touch') || text.includes('tng') ? 'tng'
      : text.includes('grab') ? 'grabpay'
        : text.includes('bigpay') ? 'bigpay'
          : text.includes('maybank') ? 'maybank'
            : text.includes('cimb') ? 'cimb'
              : text.includes('public bank') || text.includes('sv-pbb') ? 'publicbank'
                : text.includes('rhb') ? 'rhb' : null;
  return id ? getBrand(id) : null;
}

export function brandRegistry() {
  return Object.values(BRANDS).map((brand) => ({ ...brand, logoURL: assetURL(brand.logo) }));
}
