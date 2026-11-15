import './globals.css';

export const metadata = {
  title: 'Earth to Finland',
  description: 'Fly to Finland and explore NASA climate data for data center siting.',
  icons: { icon: '/legacy/assets/terra-icon.svg' },
};

export const viewport = { themeColor: '#000000' };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
