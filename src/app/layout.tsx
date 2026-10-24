import type { Metadata, Viewport } from 'next';
import { Vazirmatn } from 'next/font/google';
import './globals.css';

const vazirmatn = Vazirmatn({
	variable: '--font-vazirmatn',
	subsets: ['arabic'],
});

export const metadata: Metadata = {
	metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
	title: 'انسانی‌ساز فارسی | Persian Humanizer',
	description: 'تبدیل پیش نویس فارسی به مقاله Markdown با حفظ معنا، ساختار روشن و بازبینی E-E-A-T.',
	openGraph: {
		type: 'website',
		locale: 'fa_IR',
		title: 'انسانی‌ساز فارسی',
		description: 'متن ماشینی را آدمیزادی کن، بدون تغییر واقعیت‌ها و صدای نویسنده.',
		images: [{ url: '/og.png', width: 1200, height: 630, alt: 'انسانی‌ساز فارسی' }],
	},
	twitter: {
		card: 'summary_large_image',
		title: 'انسانی‌ساز فارسی',
		description: 'متن ماشینی را آدمیزادی کن، بدون تغییر واقعیت‌ها و صدای نویسنده.',
		images: ['/og.png'],
	},
};

export const viewport: Viewport = {
	colorScheme: 'light',
	themeColor: '#f6f3f1',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
	return (
		<html lang='fa' dir='rtl' className={`${vazirmatn.variable} h-full antialiased`}>
			<body suppressHydrationWarning className='flex min-h-full flex-col font-sans'>
				{children}
			</body>
		</html>
	);
}

