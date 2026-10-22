// Endereço do site, onde ficam as funções em api/.
export const SITE = 'https://freefliix.vercel.app';

// No navegador a API está no mesmo endereço do site; o app da TV abre de file:// e usa o do site.
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  (typeof window !== 'undefined' && /^https?:$/.test(window.location?.protocol ?? '') ? '' : SITE);
