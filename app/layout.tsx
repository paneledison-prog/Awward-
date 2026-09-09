import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DesignDNA — extract any site’s design system',
  description:
    'Render any page, measure its design system, and get build-ready tokens, components and an AI-agent brief.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
