"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** On mobile portrait, rotate the full table page 90° (landscape layout while holding phone upright). */
export function TablePagePortraitShell({ children }: { children: ReactNode }) {
  const [rotatePortrait, setRotatePortrait] = useState(false);
  const [rotateScale, setRotateScale] = useState(1);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 639px)");
    const portrait = window.matchMedia("(orientation: portrait)");
    const apply = () => setRotatePortrait(narrow.matches && portrait.matches);
    apply();
    narrow.addEventListener("change", apply);
    portrait.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      narrow.removeEventListener("change", apply);
      portrait.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  useEffect(() => {
    if (!rotatePortrait) {
      setRotateScale(1);
      return;
    }
    const outer = shellRef.current;
    if (!outer) return;
    const update = () => {
      const w = outer.clientWidth;
      const h = outer.clientHeight;
      const scale = Math.min(w / window.innerHeight, h / window.innerWidth) * 0.96;
      setRotateScale(Math.max(0.35, Math.min(1, scale)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [rotatePortrait]);

  if (!rotatePortrait) {
    return (
      <div ref={shellRef} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    );
  }

  return (
    <div ref={shellRef} className="fixed inset-0 z-0 overflow-hidden bg-[#120c09]">
      <div
        className="absolute left-1/2 top-1/2 flex min-h-0 flex-col overflow-hidden"
        style={{
          width: "100dvh",
          height: "100dvw",
          transform: `translate(-50%, -50%) rotate(90deg) scale(${rotateScale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
