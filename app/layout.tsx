import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Readiness Grader — Is Your Law Firm Invisible to AI?',
  description: 'Free tool that scans any law firm website and scores how well AI agents like ChatGPT, Perplexity, and Google AI Overviews can find, understand, and recommend your firm.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
