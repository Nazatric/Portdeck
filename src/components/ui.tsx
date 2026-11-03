'use client';

import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { Icon, type IconName } from './icons';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type TransitionDocument = { startViewTransition?: (update: () => void) => unknown };

/** Runs a state change inside a View Transition when the browser supports it, so shared elements morph on the compositor. */
export function withViewTransition(update: () => void): void {
  const doc = document as unknown as TransitionDocument;
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) { update(); return; }
  doc.startViewTransition(() => { flushSync(update); });
}

/** Keeps an element mounted while its exit animation plays. */
export function usePresence(open: boolean, exitMs = 200): { mounted: boolean; closing: boolean } {
  const [previous, setPrevious] = useState(open);
  const [lingering, setLingering] = useState(false);
  if (open !== previous) {
    // Adjust state while rendering when the prop changes (no extra effect pass): start lingering on close.
    setPrevious(open);
    setLingering(!open);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = window.setTimeout(() => setLingering(false), prefersReducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(timer);
  }, [lingering, exitMs]);
  return { mounted: open || lingering, closing: !open && lingering };
}

type PressProps = ButtonHTMLAttributes<HTMLButtonElement> & { tip?: string };

/**
 * Button with immediate press feedback: the highlight starts on pointer-down at the touch point and
 * springs back on release. State lives on the element, so pressing never re-renders React.
 */
export const PressButton = forwardRef<HTMLButtonElement, PressProps>(function PressButton(
  { className = '', tip, type = 'button', onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onKeyDown, onKeyUp, children, ...props },
  ref,
) {
  const release = (element: HTMLButtonElement) => { delete element.dataset.pressed; };
  const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--px', `${event.clientX - rect.left}px`);
    element.style.setProperty('--py', `${event.clientY - rect.top}px`);
    element.dataset.pressed = '';
    onPointerDown?.(event);
  };
  return <button
    ref={ref}
    type={type}
    data-tip={tip}
    className={`press ${className}`}
    onPointerDown={press}
    onPointerUp={(event) => { release(event.currentTarget); onPointerUp?.(event); }}
    onPointerLeave={(event) => { release(event.currentTarget); onPointerLeave?.(event); }}
    onPointerCancel={(event) => { release(event.currentTarget); onPointerCancel?.(event); }}
    onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => { if (event.key === 'Enter' || event.key === ' ') event.currentTarget.dataset.pressed = ''; onKeyDown?.(event); }}
    onKeyUp={(event: ReactKeyboardEvent<HTMLButtonElement>) => { release(event.currentTarget); onKeyUp?.(event); }}
    {...props}
  >{children}</button>;
});

export function IconButton({ icon, label, size = 18, spin = false, className = '', ...props }: Omit<PressProps, 'children'> & { icon: IconName; label: string; size?: number; spin?: boolean }) {
  return <PressButton aria-label={label} tip={label} className={`icon-button ${className}`} {...props}>
    <Icon name={icon} size={size} className={spin ? 'spin' : ''} />
  </PressButton>;
}

export interface SegmentOption<T extends string> { value: T; label: string; icon?: IconName; count?: number }

/** Segmented control with a sliding thumb; arrow keys move the selection. */
export function Segmented<T extends string>({ options, value, onChange, label, className = '' }: { options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };
  return <div className={`segmented ${className}`} role="radiogroup" aria-label={label} style={{ ['--count' as string]: options.length }} onKeyDown={move}>
    <span className="segmented-thumb" style={{ transform: `translateX(${index * 100}%)` }} aria-hidden="true" />
    {options.map((option) => {
      const active = option.value === value;
      return <button key={option.value} type="button" role="radio" aria-checked={active} aria-label={option.label} tabIndex={active ? 0 : -1} data-tip={option.icon ? option.label : undefined} className={active ? 'active' : ''} onClick={() => onChange(option.value)}>
        {option.icon && <Icon name={option.icon} size={16} />}
        <span className="segmented-label">{option.label}</span>
        {option.count !== undefined && <small>{option.count}</small>}
      </button>;
    })}
  </div>;
}

/** One shared tooltip for every [data-tip] element; shown only for fine pointers, after a short delay. */
export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let timer = 0;
    let current: HTMLElement | null = null;
    const hide = () => { window.clearTimeout(timer); current = null; ref.current?.classList.remove('visible'); };
    const over = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (target === current) return;
      hide();
      if (!target?.dataset.tip) return;
      current = target;
      timer = window.setTimeout(() => {
        const tip = ref.current;
        if (!tip || !current) return;
        tip.textContent = current.dataset.tip ?? '';
        const rect = current.getBoundingClientRect();
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
        const top = rect.bottom + 8 + height < window.innerHeight ? rect.bottom + 8 : rect.top - 8 - height;
        tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        tip.classList.add('visible');
      }, 420);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  return <div ref={ref} className="tooltip" role="tooltip" aria-hidden="true" />;
}
