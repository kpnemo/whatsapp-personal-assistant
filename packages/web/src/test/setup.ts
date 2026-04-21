import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement these Radix/cmdk-used APIs; stub them so
// dialog/select/command/etc can render without throwing.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
  }

  if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
      false;
  }
  if (
    !(Element.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture
  ) {
    (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
      () => undefined;
  }
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () =>
      undefined;
  }
}

afterEach(() => {
  cleanup();
});
