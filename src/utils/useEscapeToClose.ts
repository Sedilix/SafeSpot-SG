/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

/**
 * Closes a dialog on Escape (hardware keyboards, switch access, and the
 * keyboard shortcuts screen readers send). Call it before the dialog's
 * `if (!isOpen) return null`, since hooks can't follow an early return.
 */
export function useEscapeToClose(isOpen: boolean, onClose: () => void): void {
  // A ref, so a new onClose each render doesn't re-subscribe the listener.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);
}
