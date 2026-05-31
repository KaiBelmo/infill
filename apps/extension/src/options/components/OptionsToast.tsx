import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { debugLog } from "@/shared/debug-log";

type OptionsToastProps = {
  action?: {
    label: string;
    onClick: () => void;
  };
  children: ReactNode;
  tone?: "default" | "error";
};

export function OptionsToast({ action, children, tone = "default" }: OptionsToastProps) {
  const toneClass = tone === "error"
    ? "bg-[var(--color-danger)]"
    : "bg-[var(--color-black)]";

  useEffect(() => {
    const toast = document.querySelector("[data-options-toast]");
    const rect = toast?.getBoundingClientRect();
    debugLog("[options-toast] mounted", {
      tone,
      hasAction: Boolean(action),
      text: typeof children === "string" ? children : undefined,
      inDom: Boolean(toast),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rect: rect
        ? {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height
          }
        : undefined
    });

    return () => {
      debugLog("[options-toast] unmounted", {
        tone,
        text: typeof children === "string" ? children : undefined
      });
    };
  }, [action, children, tone]);

  return createPortal(
    <aside
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`fixed bottom-5 right-5 z-[9999] flex max-w-[min(520px,calc(100vw-2.5rem))] animate-[rise-in_180ms_ease-out] items-start gap-3 rounded-[18px] border border-white/15 ${toneClass} px-4 py-3 text-white shadow-[0_18px_44px_rgba(15,23,42,0.28)] sm:bottom-6 sm:right-6`}
      data-options-toast=""
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="min-w-0 whitespace-normal text-sm font-semibold leading-5">{children}</span>
      {action ? (
        <button
          className="shrink-0 rounded-full bg-white px-3 py-2 text-xs font-[780] uppercase tracking-[0.1em] text-[var(--color-black)] transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </aside>,
    document.body
  );
}
