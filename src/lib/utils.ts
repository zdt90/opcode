import type React from "react";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines multiple class values into a single string using clsx and tailwind-merge.
 * This utility function helps manage dynamic class names and prevents Tailwind CSS conflicts.
 * 
 * @param inputs - Array of class values that can be strings, objects, arrays, etc.
 * @returns A merged string of class names with Tailwind conflicts resolved
 * 
 * @example
 * cn("px-2 py-1", condition && "bg-blue-500", { "text-white": isActive })
 * // Returns: "px-2 py-1 bg-blue-500 text-white" (when condition and isActive are true)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * MouseDown handler for message bubble wrappers.
 *
 * On triple-click the browser extends the selection beyond the clicked
 * element into surrounding chrome. We let the browser do its normal
 * paragraph-selection first, then in the next animation frame we check
 * whether the resulting selection escaped the wrapper. If it did, we clip
 * it back to the wrapper boundary; if it didn't (normal paragraph select),
 * we leave it completely untouched.
 *
 * CSS `user-select: contain` would achieve the same thing but is only
 * supported by Firefox, so we use this JS fallback for WebKit / Chromium.
 */
export function containSelectionOnTripleClick(e: React.MouseEvent): void {
  if (e.detail < 3) return;
  const wrapper = e.currentTarget as HTMLElement;
  requestAnimationFrame(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // If the common ancestor is inside the wrapper the selection is already
    // contained — leave it alone (this is the normal paragraph-select case).
    const ancestor = range.commonAncestorContainer;
    if (wrapper === ancestor || wrapper.contains(ancestor)) return;
    // Selection escaped the wrapper — clip it to the wrapper's contents.
    const clipped = document.createRange();
    clipped.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(clipped);
  });
}