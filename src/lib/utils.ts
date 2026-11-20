import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge Tailwind CSS class names.
 *
 * Combines `clsx`-style conditional class inputs and resolves conflicting
 * Tailwind utility classes via `tailwind-merge`, so later classes win.
 *
 * @param inputs - Class values to merge (strings, arrays, objects, etc.)
 * @returns A single, deduplicated class name string
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
