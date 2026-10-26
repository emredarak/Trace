"use client";

import { useEffect } from "react";
import { startAutoSync } from "../lib/outbox";

// Servis çalışanını kaydeder, bağlantı dönünce kuyruğu boşaltır.
export default function SwRegister() {
  useEffect(() => {
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }
    } catch {
      /* desteklenmiyorsa yoksay */
    }
    return startAutoSync();
  }, []);
  return null;
}
