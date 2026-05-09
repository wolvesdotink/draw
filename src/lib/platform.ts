/**
 * Platform + viewport detection.
 *
 * Two flavors:
 *   - osPlatform(): "ios" | "macos" | "other". Memoized; set once at boot.
 *   - useViewport(): live { isCompact, isRegular, isWide } from window.matchMedia.
 *
 * We intentionally avoid pulling in @tauri-apps/plugin-os to keep the Rust
 * dependency surface small. The userAgent + maxTouchPoints heuristic is
 * sufficient because the only thing this module needs to discriminate is
 * "treat the UI as touch-first iPad" vs "desktop Mac chrome" vs "other"
 * (browser dev mode / unknown).
 *
 * The viewport hook uses useSyncExternalStore — works on the first render,
 * subscribes to media-query changes, and is concurrent-safe.
 *
 * Breakpoints — three zones:
 *   - compact:  < 768px   → iPhone, iPad Slide Over, half-screen Split View
 *   - regular:  768–1023  → iPad portrait, iPad split half-screen
 *   - wide:    >= 1024px  → iPad landscape full-screen, desktop
 */

import { useSyncExternalStore } from "react";

export type OsPlatform = "ios" | "macos" | "other";

let cachedOs: OsPlatform | null = null;

export function osPlatform(): OsPlatform {
  if (cachedOs !== null) return cachedOs;
  cachedOs = detect();
  return cachedOs;
}

function detect(): OsPlatform {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "other";
  }
  const ua = navigator.userAgent || "";
  // Classic iOS WebView (iPhone + iPad simulator + older iPads).
  if (/iPad|iPhone|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports as Macintosh in WKWebView. Discriminate by touch.
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) {
    return "ios";
  }
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  return "other";
}

// ---- Viewport hook ----------------------------------------------------

export interface Viewport {
  /** Width < 768px — iPhone, iPad Slide Over, half-screen Split View. */
  isCompact: boolean;
  /** 768 ≤ width < 1024 — iPad portrait, iPad split half-screen. */
  isRegular: boolean;
  /** Width ≥ 1024 — iPad landscape full-screen, desktop. */
  isWide: boolean;
}

const COMPACT_QUERY = "(max-width: 767px)";
const WIDE_QUERY = "(min-width: 1024px)";

function getSnapshot(): Viewport {
  if (typeof window === "undefined") {
    // SSR / Node fallback — assume desktop wide.
    return { isCompact: false, isRegular: false, isWide: true };
  }
  const isCompact = window.matchMedia(COMPACT_QUERY).matches;
  const isWide = window.matchMedia(WIDE_QUERY).matches;
  return {
    isCompact,
    isRegular: !isCompact && !isWide,
    isWide,
  };
}

function getServerSnapshot(): Viewport {
  return { isCompact: false, isRegular: false, isWide: true };
}

// useSyncExternalStore requires a stable snapshot reference between calls
// when the store hasn't changed, so we cache and only emit a new object
// when one of the matches actually flips.
let cachedViewport: Viewport = getSnapshot();

function refreshViewport(): Viewport {
  const next = getSnapshot();
  if (
    next.isCompact !== cachedViewport.isCompact ||
    next.isRegular !== cachedViewport.isRegular ||
    next.isWide !== cachedViewport.isWide
  ) {
    cachedViewport = next;
  }
  return cachedViewport;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const compactMql = window.matchMedia(COMPACT_QUERY);
  const wideMql = window.matchMedia(WIDE_QUERY);
  const handler = () => {
    refreshViewport();
    callback();
  };
  // Older Safari (< 14) used addListener / removeListener (now deprecated
  // but still part of MediaQueryList for back-compat). Modern WebKit on
  // iOS 16+ supports addEventListener, so we always go through that path.
  compactMql.addEventListener("change", handler);
  wideMql.addEventListener("change", handler);
  return () => {
    compactMql.removeEventListener("change", handler);
    wideMql.removeEventListener("change", handler);
  };
}

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, refreshViewport, getServerSnapshot);
}

// ---- Convenience flag -------------------------------------------------

/**
 * True for iOS / iPadOS. Use this to opt into mobile-first behaviors
 * (e.g. drawer sidebar default, larger touch targets, suppressing
 * desktop-only chrome). Keep checks coarse — most layout decisions
 * should key off useViewport(), not the OS.
 */
export function isMobileOs(): boolean {
  return osPlatform() === "ios";
}
