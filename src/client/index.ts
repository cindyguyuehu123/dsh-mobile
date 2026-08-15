/**
 * dsh-mobile browser half: touch/mobile CSS + small runtime adjustments for
 * the Harness web GUI, injected as one <style> tag (no React, no imports —
 * the bundle rides the shell's module loader with zero externals).
 *
 * Responsibilities:
 *  - prevent iOS focus-zoom on small inputs (>=16px font on coarse pointers);
 *  - kill 300ms tap delay / accidental double-tap zoom on interactive
 *    elements;
 *  - keep the app inside the notch / home indicator in iOS standalone mode
 *    and lift the whole app above the on-screen keyboard (visualViewport
 *    delta drives a --dsh-mobile-kb custom property);
 *  - modestly enlarge the always-visible message action tap targets on
 *    coarse pointers.
 * @module dsh-mobile/client
 */

/** Minimal structural client context (the guarded ctx the runner hands apply). */
export interface MobileClientContext {
  effect(callback: () => (() => void) | void, label?: string): unknown
}

/** Nothing required from other client packages. */
export const inject: string[] = []

const CSS = `
/* dsh-mobile: mobile & touch adjustments */
html {
  -webkit-text-size-adjust: 100%;
}

@media (pointer: coarse), (hover: none) {
  input, textarea, select {
    font-size: 16px; /* iOS Safari zooms focused inputs smaller than 16px */
  }
  button, [role='button'], a, label, select {
    touch-action: manipulation; /* no double-tap zoom on taps */
  }
  * {
    -webkit-tap-highlight-color: transparent;
  }
  /* Keep the app inside the notch / home indicator and above the keyboard.
     In regular iOS tabs env() insets are 0, so this only bites in
     standalone mode; --dsh-mobile-kb is set from visualViewport in JS. */
  #root {
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: max(env(safe-area-inset-bottom, 0px), var(--dsh-mobile-kb, 0px));
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    background: var(--dsw-alias-bg-base, #0b1220);
  }
}

@media (pointer: coarse) {
  /* Always-visible message actions (ui-conversation + dsh-webchatlike) get
     friendlier touch targets. Class-suffix matching rides the harness
     CSS-module naming (<hash>_<local>), so it survives re-hashes. */
  [class$='_action'] {
    min-width: 34px;
    min-height: 34px;
  }
  [class$='_pagerButton'] {
    min-width: 30px;
    min-height: 30px;
  }
}
`

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: MobileClientContext): void {
  ctx.effect(() => {
    const root = document.documentElement
    root.classList.add('dsh-mobile')

    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-mobile')
    style.setAttribute('data-plugin-css', 'dsh-mobile/mobile')
    style.textContent = CSS
    document.head.appendChild(style)

    // Keyboard inset: when the visual viewport shrinks (iOS/Android on-screen
    // keyboard), lift #root so the composer stays above the keyboard.
    const setInset = (): void => {
      const vv = window.visualViewport
      if (vv === null) return
      const inset = Math.max(0, window.innerHeight - vv.height)
      root.style.setProperty('--dsh-mobile-kb', inset > 8 ? `${inset}px` : '0px')
    }
    setInset()
    window.visualViewport?.addEventListener('resize', setInset)
    window.visualViewport?.addEventListener('scroll', setInset)

    return () => {
      style.remove()
      root.classList.remove('dsh-mobile')
      root.style.removeProperty('--dsh-mobile-kb')
      window.visualViewport?.removeEventListener('resize', setInset)
      window.visualViewport?.removeEventListener('scroll', setInset)
    }
  }, 'dsh-mobile: touch styles')
}
