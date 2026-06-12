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
 * On triple-click the browser extends the selection well beyond the clicked
 * element (into surrounding chrome). We intercept and confine the selection
 * to the wrapper element instead.
 *
 * CSS `user-select: contain` would achieve the same thing but is only
 * supported by Firefox, so we use a JS fallback for WebKit / Chromium.
 */
export function containSelectionOnTripleClick(e: React.MouseEvent): void {
  if (e.detail < 3) return;
  e.preventDefault();
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(e.currentTarget as Node);
  sel.addRange(range);
}