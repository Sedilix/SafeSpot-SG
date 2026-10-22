/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab / Shift+Tab inside an open dialog so keyboard and switch users
 * can't wander onto the page behind it, and hands focus back to whatever
 * opened the dialog once it closes. Like useEscapeToClose, call it before the
 * dialog's `if (!isOpen) return null`.
 */
export function useFocusTrap(isOpen: boolean, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (e.key !== 'Tab' || !container) return;
      const items = Array.from<HTMLElement>(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !container.contains(active);
      if (e.shiftKey && (active === first || active === container || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [isOpen, containerRef]);
}
