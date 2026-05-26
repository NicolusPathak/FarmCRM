import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import { Inter } from 'next/font/google';
import { GlobalLoadingProvider } from '@/components/ui/GlobalLoading';

// Inter is the closest free match to Square's Aktiv-Grotesk-style sans.
// Keeping the --font-dm-sans variable name so we don't have to touch every
// inline font-family in the codebase — the variable now points at Inter.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-dm-sans',
});

export const metadata: Metadata = {
  title: "Chaudhary Farm — Shop Dashboard",
  description: "Private customer management dashboard for Chaudhary Farm",
};

// Without this, mobile browsers render at a default 980px viewport and
// scale everything to fit — which makes the page look tiny, right-shifts
// the content (because the desktop CSS reserves 240px for the sidebar),
// and hides the mobile hamburger entirely. `width=device-width` is THE
// fix. `viewport-fit=cover` lets us paint into the iPhone safe-area
// (notch / home indicator) using the env(safe-area-inset-*) values in
// globals.css. We deliberately leave maximumScale unset so users with
// vision needs can still pinch-zoom — this is a shop floor app, not a
// locked-down kiosk.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0F172A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <GlobalLoadingProvider>
          {children}
        </GlobalLoadingProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: "var(--font-dm-sans), sans-serif",
              background: '#0F172A',
              color: '#F8FAFC',
              borderRadius: '12px',
              padding: '12px 16px',
              fontSize: '14px',
              boxShadow: '0 10px 30px rgba(15, 23, 42, 0.25)',
            },
            success: { iconTheme: { primary: '#16A34A', secondary: '#F8FAFC' } },
            error:   { iconTheme: { primary: '#DC2626', secondary: '#F8FAFC' } },
          }}
        />
      </body>
    </html>
  );
}
