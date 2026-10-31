"use client";
import { useEffect, useState } from "react";

export function KediSessionBridge({ adminOrigin }: { adminOrigin?: string }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!adminOrigin || window.parent === window) return;
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    const receive = async (event: MessageEvent) => {
      if (event.origin !== adminOrigin || event.source !== window.parent ||
        event.data?.type !== "kedi-seo:session" || typeof event.data.token !== "string" || busy) return;
      busy = true;
      try {
        const response = await fetch("/api/kedi-seo/session", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: event.data.token }), cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error();
        setExpired(false);
        clearTimeout(timer);
        timer = setTimeout(() => setExpired(true), Math.max(0, result.expiresAt - Date.now()));
        if (window.location.pathname === "/kedi" || result.switched) window.location.replace("/");
      } catch { setExpired(true); }
      finally { busy = false; }
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "kedi-seo:ready" }, adminOrigin);
    return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [adminOrigin]);
  return expired ? <div role="alert" className="fixed inset-0 z-[9999] bg-background p-8">
    Phiên Kedi SEO đã hết hạn. Hãy mở lại từ Kedi Admin.
  </div> : null;
}
