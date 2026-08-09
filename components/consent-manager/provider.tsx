'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import {
  ConsentBanner,
  ConsentDialog,
  ConsentManagerProvider,
  policyPackPresets,
} from '@c15t/nextjs'
import { isPublicRoutePath } from '@/lib/auth-route-policy'

type ConsentManagerClientProps = {
  children: ReactNode
  hostedEnabled: boolean
}

const consentCategories = ['necessary', 'measurement', 'marketing'] as const

const legalLinks = {
  privacyPolicy: {
    href: '/privacy',
    label: 'Privacy Policy',
  },
  termsOfService: {
    href: '/terms',
    label: 'Terms of Service',
  },
}

// Map c15t tokens onto the project's existing CSS variables so the banner/dialog
// inherit our palette, radius, type, and dark-mode switch automatically. c15t
// emits separate :root and :root.dark blocks; the same var() references resolve
// against our swapping --card / --border / etc. in both.
const sharedColors = {
  primary: 'var(--primary)',
  primaryHover: 'color-mix(in oklch, var(--primary) 90%, transparent)',
  surface: 'var(--card)',
  surfaceHover: 'var(--accent)',
  border: 'var(--border)',
  borderHover: 'var(--ring)',
  text: 'var(--foreground)',
  textMuted: 'var(--muted-foreground)',
  textOnPrimary: 'var(--primary-foreground)',
  overlay: 'var(--overlay)',
  switchTrack: 'var(--muted)',
  switchTrackActive: 'var(--primary)',
  switchThumb: 'var(--background)',
}

const consentTheme = {
  colors: sharedColors,
  dark: sharedColors,
  typography: {
    fontFamily:
      'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  radius: {
    sm: 'calc(var(--radius) - 2px)',
    md: 'var(--radius)',
    lg: 'calc(var(--radius) + 4px)',
  },
  shadows: {
    sm: 'var(--app-shadow-sm)',
    md: 'var(--app-shadow-md)',
    lg: 'var(--app-shadow-lg)',
  },
  consentActions: {
    accept: { variant: 'primary' as const, mode: 'filled' as const },
    reject: { variant: 'neutral' as const, mode: 'stroke' as const },
    customize: { variant: 'neutral' as const, mode: 'ghost' as const },
  },
}

export function ConsentManagerClient({
  children,
  hostedEnabled,
}: ConsentManagerClientProps) {
  const pathname = usePathname()
  const showConsentUi = pathname ? isPublicRoutePath(pathname) : false

  if (!showConsentUi) {
    return <>{children}</>
  }

  const options = hostedEnabled
    ? {
        mode: 'hosted' as const,
        backendURL: '/api/c15t',
        consentCategories: [...consentCategories],
        legalLinks,
        theme: consentTheme,
      }
    : {
        mode: 'offline' as const,
        offlinePolicy: {
          policyPacks: [
            policyPackPresets.europeOptIn(),
            policyPackPresets.californiaOptOut(),
            policyPackPresets.worldNoBanner(),
          ],
        },
        consentCategories: [...consentCategories],
        legalLinks,
        overrides: { country: 'DE' },
        theme: consentTheme,
      }

  return (
    <ConsentManagerProvider options={options}>
      <ConsentBanner legalLinks={['privacyPolicy', 'termsOfService']} />
      <ConsentDialog />
      {children}
    </ConsentManagerProvider>
  )
}
