window.__ModuleLoader__.load({
	id: "dsh-mobile",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		/** Nothing required from other client packages. */
		const inject = [];
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

@media (max-width: 640px) {
  /* Composer action row on narrow screens: the command/permission/model/send
     row does not fit the card, flex-squeezes the permission group to width 0
     and overlaps the model trigger. Shrink the button gaps and forbid
     shrinking so every button keeps its natural width and stays inside the
     card. Scope via the module-local suffixes (_card/_row/_tools). */
  [class$='_card'] [class$='_row'] {
    gap: 4px !important;
    flex-wrap: wrap !important;
  }
  [class$='_card'] [class$='_row'] > * {
    flex-shrink: 0 !important;
  }
  [class$='_card'] [class$='_tools'] {
    gap: 6px !important;
  }
  [class$='_card'] [class$='_trailing'] {
    gap: 4px !important;
  }
}
`;
		/**
		* Client plugin body.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const root = document.documentElement;
				root.classList.add("dsh-mobile");
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "dsh-mobile");
				style.setAttribute("data-plugin-css", "dsh-mobile/mobile");
				style.textContent = CSS;
				document.head.appendChild(style);
				const setInset = () => {
					const vv = window.visualViewport;
					if (vv === null) return;
					const inset = Math.max(0, window.innerHeight - vv.height);
					root.style.setProperty("--dsh-mobile-kb", inset > 8 ? `${inset}px` : "0px");
				};
				setInset();
				window.visualViewport?.addEventListener("resize", setInset);
				window.visualViewport?.addEventListener("scroll", setInset);
				return () => {
					style.remove();
					root.classList.remove("dsh-mobile");
					root.style.removeProperty("--dsh-mobile-kb");
					window.visualViewport?.removeEventListener("resize", setInset);
					window.visualViewport?.removeEventListener("scroll", setInset);
				};
			}, "dsh-mobile: touch styles");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
