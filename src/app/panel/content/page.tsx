import logo from '@/assets/logo.svg';
import ContentPanel from '@/components/panel/ContentPanel';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
	title: 'تولید محتوای دسته | نگارش',
	description: 'تولید، بررسی و خروجی‌گرفتن محتوای صفحه‌های دسته‌بندی محصول.',
	robots: { index: false, follow: false },
};

export default function ContentPanelPage() {
	return (
		<>
			<header className='site-chrome'>
				<div className='nav-wrap'>
					<div className='nav-inner'>
						<nav aria-label='ناوبری اصلی' className='top-nav !justify-between'>
							<Link href='/' className='flex min-w-0 items-center gap-3' aria-label='بازگشت به ویرایشگر'>
								<Image src={logo} alt='' className='h-10 w-auto' priority />
							</Link>
							<div className='flex flex-wrap items-center gap-2'>
								<Link href='/panel' className='outline-button'>
									پنل API
								</Link>
								<Link href='/' className='outline-button'>
									ویرایشگر وب
								</Link>
							</div>
						</nav>
					</div>
				</div>
			</header>
			<main className='site-shell'>
				<header className='my-8 sm:my-12'>
					<h1 className='section-title'>تولید محتوای دسته</h1>
					<p className='mt-3 max-w-2xl text-sm leading-7 text-graphite sm:text-base'>
						دسته‌ها را انتخاب کنید، محتوای بالا و زیر لیست محصولات را بسازید و پیش از انتشار، نتیجه و کنترل کیفیت را بررسی کنید.
					</p>
				</header>
				<ContentPanel />
			</main>
		</>
	);
}
