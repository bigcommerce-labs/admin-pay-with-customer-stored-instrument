import type { Metadata } from 'next';
import { StyledComponentsRegistry } from './registry';
import { BigDesignProviders } from './providers';

export const metadata: Metadata = {
  title: 'Pay with customer saved payments',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap"
        />
      </head>
      <body>
        <StyledComponentsRegistry>
          <BigDesignProviders>{children}</BigDesignProviders>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
