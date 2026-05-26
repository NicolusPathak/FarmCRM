import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import { DM_Sans, DM_Serif_Display } from 'next/font/google';
import { GlobalLoadingProvider } from '@/components/ui/GlobalLoading';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-dm-sans',
});

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif',
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
  themeColor: '#1A1715',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerifDisplay.variable}`}>
      <body>
        <GlobalLoadingProvider>
          {children}
        </GlobalLoadingProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: "var(--font-dm-sans), sans-serif",
              background: '#1A1208',
              color: '#F5ECD7',
              borderRadius: '12px',
              padding: '12px 16px',
            },
            success: { iconTheme: { primary: '#10b981', secondary: '#F5ECD7' } },
            error: { iconTheme: { primary: '#C0392B', secondary: '#F5ECD7' } },
          }}
        />
      </body>
    </html>
  );
}
