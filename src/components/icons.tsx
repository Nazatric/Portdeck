import type { CSSProperties } from 'react';
import { BRAND_PATHS, ICON_PATHS, type BrandName, type IconName } from './icon-data';

export type { BrandName, IconName };

/** Stroke icon from the bundled Lucide set. Rendered inline, so nothing is fetched at runtime. */
export function Icon({ name, size = 18, strokeWidth = 1.75, className = '', style }: { name: IconName; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }) {
  return <svg className={`icon ${className}`} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={ICON_PATHS[name]} />
  </svg>;
}

/** Monochrome technology mark from the bundled Simple Icons set. */
export function BrandIcon({ name, size = 18, className = '' }: { name: BrandName; size?: number; className?: string }) {
  return <svg className={`icon brand-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d={BRAND_PATHS[name]} />
  </svg>;
}

/** The PortDeck mark: a bracketed slash. */
export function Logo({ size = 22, className = '' }: { size?: number; className?: string }) {
  return <svg className={`logo ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M8 4.5H5v15h3M16 4.5h3v15h-3" stroke="currentColor" />
    <path className="logo-slash" d="M14 6 10 18" stroke="var(--accent)" />
  </svg>;
}

export function frameworkBrand(framework: string): BrandName {
  if (framework === 'Next.js') return 'nextjs';
  if (framework === 'React') return 'react';
  if (framework === 'HTML') return 'html5';
  return 'javascript';
}

export function fileIcon(path: string): IconName {
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(path)) return 'file-image';
  if (/\.json$/i.test(path)) return 'file-braces';
  if (/\.(m?[jt]sx?|css|s[ac]ss|less|html?|vue|svelte)$/i.test(path)) return 'file-code';
  if (/\.(md|mdx|txt)$/i.test(path)) return 'file-text';
  if (/\.zip$/i.test(path)) return 'file-archive';
  return 'file';
}
