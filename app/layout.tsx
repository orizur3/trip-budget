import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'תקציב הטיול - תאילנד',
  description: 'מעקב הוצאות משותף לטיול',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
