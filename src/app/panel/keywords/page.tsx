import KeywordReview from '@/components/panel/KeywordReview';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
	title: 'بررسی کلمات | نگارش',
	description: 'عبارت‌های جست‌وجوی گوگل برای صفحه‌های دسته و برنامهٔ بلاگ.',
	robots: { index: false, follow: false },
};

export default function KeywordsPage() {
	return (
		<main className='site-shell' dir='rtl'>
			<header className='my-8 flex flex-wrap items-end justify-between gap-3 sm:my-12'>
				<div>
					<h1 className='section-title'>بررسی ماهانهٔ کلمات</h1>
					<p className='mt-3 max-w-2xl text-sm leading-7 text-graphite sm:text-base'>
						جست‌وجوهای واقعی گوگل دربارهٔ هر دسته، جدا شده به «صفحهٔ دسته» و «بلاگ». هیچ عبارتی بدون تأیید شما وارد صفحه نمی‌شود.
					</p>
				</div>
				<Link href='/panel/content' className='outline-button'>تولید محتوای دسته</Link>
			</header>
			<KeywordReview />
		</main>
	);
}
