/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    theme: {
        extend: {
            // Stacks product typography, expressed in rem to honor browser zoom.
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', '"Noto Sans"', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
            },
            fontSize: {
                xs: ['0.75rem', { lineHeight: '1.36' }],
                sm: ['0.8125rem', { lineHeight: '1.4' }],
                base: ['0.875rem', { lineHeight: '1.4' }],
                lg: ['var(--type-body-large)', { lineHeight: '1.4' }],
                xl: ['var(--type-subheading)', { lineHeight: '1.4' }],
                '2xl': ['var(--type-title)', { lineHeight: '1.4' }],
                '3xl': ['var(--type-headline)', { lineHeight: '1.4' }],
                '4xl': ['var(--type-headline-large)', { lineHeight: '1.4' }],
                '5xl': ['var(--type-display)', { lineHeight: '1.34' }],
                'thread-title': ['var(--type-body-title)', { lineHeight: '1.4' }],
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
