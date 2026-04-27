// Phase 8 Plan 01 Wave 0: minimal MantineProvider + Notifications wrapper for
// component tests. Mirrors apps/web/src/app.tsx provider stack so component
// tests render Mantine components (Badge, Button, Tooltip) without crashing.
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider>
      <Notifications />
      {children}
    </MantineProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react';
