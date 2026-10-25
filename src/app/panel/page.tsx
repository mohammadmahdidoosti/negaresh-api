import logo from '@/assets/logo.svg';
import ApiPanel from '@/components/panel/ApiPanel';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
	title: 'پنل API | نگارش',
	description: 'اتصال، بررسی و تست زندهٔ API نگارش.',
	robots: { index: false, follow: false },
};

export default function PanelPage() {
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
								<Link href='/panel/content' className='outline-button'>
									تولید محتوا
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
					<h1 className='section-title'>پنل API</h1>
					<p className='mt-3 max-w-2xl text-sm leading-7 text-graphite sm:text-base'>
						اطلاعات اتصال، بررسی ارتباط با اوپن‌روتر و تست زندهٔ همان API که ابزارهای دیگر صدا می‌زنند.
					</p>
				</header>
				<ApiPanel />
			</main>
		</>
	);
}
