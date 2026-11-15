import './globals.css';

export const metadata = {
  title: 'DataX',
  description: 'Explore satellite maps and NASA climate data for data center siting in Finland and Canada.',
  icons: { icon: '/legacy/assets/terra-icon.svg' },
};

export const viewport = { themeColor: '#000000' };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
