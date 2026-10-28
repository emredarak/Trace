"use client";

import { useEffect } from "react";
import { startAutoSync } from "../lib/outbox";

// Registers the service worker and drains the queue when connectivity returns.
export default function SwRegister() {
  useEffect(() => {
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }
    } catch {
      /* ignore when unsupported */
    }
    return startAutoSync();
  }, []);
  return null;
}
