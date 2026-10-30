"use client";
import {useEffect, useState} from "react";

// The design's save confirmation: one ink pill, bottom centre, gone after 2.8s.
// Call toast("Ana · 24 · saved") from anywhere; <Toast/> is mounted once in Providers.
export function toast(text: string, tone: "ok" | "error" = "ok") {
  window.dispatchEvent(new CustomEvent("bh-toast", {detail: {text, tone}}));
}
toast.error = (text: string) => toast(text, "error");

export function Toast() {
  const [t, setT] = useState<{text: string; tone: string; id: number} | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      clearTimeout(timer); setT({...d, id: Date.now()});
      timer = setTimeout(() => setT(null), d.tone === "error" ? 5000 : 2800);
    };
    addEventListener("bh-toast", on);
    return () => { removeEventListener("bh-toast", on); clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
    className="bh-pop fixed bottom-6 left-1/2 z-[90] flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full bg-[var(--ink)] px-[18px] py-2.5 text-[13px] font-medium text-[var(--paper)] shadow-[0_16px_48px_#0a0a0a40]">
    <span className={"size-1.5 shrink-0 rounded-full " + (t.tone === "error" ? "bg-[#e5533f]" : "bg-[var(--signal)]")}/>{t.text}
  </div>;
}
