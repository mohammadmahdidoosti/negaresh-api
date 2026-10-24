import logo from '@/assets/logo.svg';
import HumanizerApp from '@/components/HumanizerApp';
import Image from 'next/image';
import Link from 'next/link';

export default function Home() {
	return (
		<>
			<header className='site-chrome'>
				<div className='nav-wrap'>
					<div className='nav-inner'>
						<nav aria-label='ناوبری اصلی' className='top-nav'>
							<a
								href='#'
								className='flex min-w-0 items-center gap-3'
								aria-label='انسانی‌ساز فارسی، ابتدای صفحه'
							>
								<Image src={logo} alt='' className='h-10 w-auto' priority />
							</a>
						</nav>
					</div>
				</div>
			</header>

			<main className='site-shell'>
				<a href='#workspace' className='sr-only focus:not-sr-only focus:mb-4 focus:inline-block'>
					رفتن به ویرایشگر
				</a>

				<header className='hero-panel fade-up'>
					<h1 className='hero-title'>تبدیل متن هوش مصنوعی به لحن اصیل انسانی</h1>
					<p className='hero-copy'>
						بازنویسی هوشمند متن فارسی با حفظ کامل حقایق، اصلاح ریتم جملات و افزودن تجربه برای اعتماد خواننده
						و موتورهای جستجو.
					</p>
					<div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
						<a href='#workspace' className='primary-button'>
							شروع بازنویسی
						</a>
						<Link href='/how-it-works' className='inline-flex items-center rounded-full border border-ash px-6 py-3 text-sm font-medium text-graphite transition-colors hover:bg-field'>
							بیشتر بدانید
						</Link>
					</div>
				</header>

				<HumanizerApp />

				<footer className='mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-ash py-8 text-xs leading-6 text-smoke'>
					<span>ابزار تحریریه برای نویسندگان و تیم‌های سئو</span>
					<div className='flex items-center gap-1'>
						<span className='w-2 h-2 bg-green-500 rounded-full inline-block'></span>
						<span dir='ltr' className='font-medium text-graphite'>
							سرویس فعال
						</span>
					</div>
				</footer>
			</main>
		</>
	);
}
