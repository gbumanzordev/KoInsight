// Phase 8 Plan 01 Wave 0: web RTL scaffold.
// Imports jest-dom matchers (toBeInTheDocument, toHaveAttribute, etc.) for vitest.
import '@testing-library/jest-dom/vitest';

// Phase 8 Plan 04 (Rule 3 fix): Mantine's MantineProvider reads
// `window.matchMedia` during its color-scheme effect. jsdom does not implement
// matchMedia, so we install a no-op stub so MantineProvider mounts cleanly.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
