'use client';

import { GlobalStyles } from '@bigcommerce/big-design';
import { ThemeProvider } from 'styled-components';
import { theme } from '@bigcommerce/big-design-theme';

export function BigDesignProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles />
      {children}
    </ThemeProvider>
  );
}
