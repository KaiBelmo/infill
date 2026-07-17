import type { ReactNode } from "react";

type OptionsNoticeProps = {
  children: ReactNode;
};

export function OptionsNotice({ children }: OptionsNoticeProps) {
  return (
    <div className="rounded-[2rem] border border-[rgba(178,117,0,0.18)] bg-white/68 backdrop-blur-xl backdrop-saturate-150 px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
      {children}
    </div>
  );
}
