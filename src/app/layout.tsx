import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sana — Personal Health Companion',
  description: 'Offline-first health companion for Nigeria',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
