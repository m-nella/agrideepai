import "./globals.css";

export const metadata = {
  title: "AfriDeepAI — Agriculture & Livestock Intelligence",
  description:
    "AfriDeepAI is an intelligent AI assistant specialized in agriculture, livestock, crop production, animal farming, agribusiness, and agricultural information for Rwanda and the world.",
  keywords: [
    "Agriculture AI",
    "Livestock AI",
    "Rwanda Agriculture",
    "Farming AI",
    "Crop Disease AI",
    "Agribusiness",
    "African Agriculture",
    "AfriDeepAI"
  ],
  icons: {
    icon: "/logo.png"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
