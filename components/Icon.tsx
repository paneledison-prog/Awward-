'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Download04Icon,
  Link02Icon,
  MinusSignIcon,
  PlusSignIcon,
  Search01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';

/**
 * Every icon in the app comes through here.
 *
 * One source (Hugeicons stroke-rounded), one size and one stroke weight, so
 * icons cannot drift apart the way the loose text glyphs they replaced did —
 * an arrow, a tick and a chevron typed as characters render at whatever weight
 * and baseline the font happens to give them.
 */
const ICONS = {
  search: Search01Icon,
  arrowRight: ArrowRight01Icon,
  download: Download04Icon,
  tick: Tick02Icon,
  copy: Copy01Icon,
  plus: PlusSignIcon,
  minus: MinusSignIcon,
  alert: Alert02Icon,
  link: Link02Icon,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <HugeiconsIcon
      icon={ICONS[name]}
      size={size}
      strokeWidth={strokeWidth}
      // Decorative: every icon in this app sits beside its own label.
      aria-hidden
      className={`shrink-0 ${className}`}
    />
  );
}
