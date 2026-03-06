import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAIT MVP — Contract RAG Analyzer',
  description: 'Upload and analyze contracts with local AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
