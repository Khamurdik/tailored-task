import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, with later Tailwind utilities winning over earlier ones.
 *
 * `clsx` alone concatenates, so `cn('p-2', 'p-4')` would emit both and leave the
 * winner to CSS source order — not something a component author can reason
 * about. `twMerge` resolves the conflict to the last one, which is what a
 * `className` prop passed by a caller is expected to do.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
