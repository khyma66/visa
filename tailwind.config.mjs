/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    theme: {
        extend: {
            // Community-first type hierarchy. Rem units preserve browser text sizing.
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', '"Noto Sans"', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
            },
            fontSize: {
                xs: ['var(--type-meta)', { lineHeight: '1.5' }],
                sm: ['var(--type-ui)', { lineHeight: '1.5' }],
                base: ['var(--type-body)', { lineHeight: '1.5' }],
                lg: ['var(--type-body-large)', { lineHeight: '1.5' }],
                xl: ['var(--type-subheading)', { lineHeight: '1.3' }],
                '2xl': ['var(--type-title)', { lineHeight: '1.3' }],
                '3xl': ['var(--type-headline)', { lineHeight: '1.25' }],
                '4xl': ['var(--type-headline-large)', { lineHeight: '1.25' }],
                '5xl': ['var(--type-display)', { lineHeight: '1.2' }],
                'thread-title': ['var(--type-body-title)', { lineHeight: '1.35' }],
            },
            // Existing weight aliases now follow the product's restrained 600 bold.
            fontWeight: { bold: '600', extrabold: '600', black: '600' },
            colors: {
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },
        },
    },
    plugins: [],
}
