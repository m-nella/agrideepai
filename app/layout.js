import "./globals.css";

export const metadata = {
  title: "AfriDeepAI — Agriculture & Livestock Intelligence",
  description: "Professional AI assistance for agriculture, livestock, crop production, animal farming and agribusiness in Rwanda and globally.",
  icons: { icon: "/logo.png" }
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
