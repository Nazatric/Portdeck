import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PortDeck',
    short_name: 'PortDeck',
    description: 'Open and preview local web projects, offline.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e0c0d',
    theme_color: '#0e0c0d',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
