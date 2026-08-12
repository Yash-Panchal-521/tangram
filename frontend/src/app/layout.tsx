import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Tangram",
  description: "Real-time collaborative kanban workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* `h-full`, not `min-h-full`.

          A min-height does not make a height definite, so every `h-full` and
          `flex-1` below this resolved against `auto` — which is why the empty
          board's centred message sat at the top of a viewport-tall area doing
          nothing. Pages taller than the viewport still scroll; `html` is the
          scroll container, and the shells that want to own their own scrolling
          (the board) say `overflow-hidden` themselves. */}
      <body className="h-full flex flex-col bg-bg text-text">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
