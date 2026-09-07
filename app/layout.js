import "./globals.css";

export const metadata = {
  title: "AfriDeepAI — Agriculture & Livestock Intelligence",
  description: "Professional AI assistance for agriculture, livestock, crop production, animal husbandry, plant health and agribusiness in Rwanda and globally.",
  keywords: ["Agriculture AI","Livestock AI","Rwanda Agriculture","Crop Disease","Farming","AfriDeepAI"],
  icons: { icon: "/logo.png" },
  openGraph: { title: "AfriDeepAI", description: "Agriculture & Livestock Intelligence", type: "website" }
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
