import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'
import { ConsentManager } from '@/components/consent-manager'
import { ThemeProvider } from '@/components/theme-provider'
import { ThemeSettingsSync } from '@/components/theme-settings-sync'
import { Toaster } from '@/components/ui/toaster'
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
  SOCIAL_IMAGE,
} from '@/lib/seo'
import {
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  isThemePreference,
} from '@/lib/theme-preferences'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1eb' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0c0b' },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: 'website',
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const themeCookie = cookieStore.get(THEME_COOKIE_NAME)?.value
  const defaultTheme = isThemePreference(themeCookie) ? themeCookie : "system"

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme={defaultTheme}
          enableSystem
          storageKey={THEME_STORAGE_KEY}
        >
          <ThemeSettingsSync />
          <ConsentManager>{children}</ConsentManager>
          <Toaster />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
