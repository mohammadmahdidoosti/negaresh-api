import logo from '@/assets/logo-light.svg';
import {
	ArrowLeft,
	Check,
	ChevronDown,
	Fingerprint,
	GitBranch,
	LockKeyhole,
	ScanText,
	ShieldCheck,
} from 'lucide-react';
import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import styles from './page.module.css';

const title = 'بیشتر بدانید | فناوری نگارش';
const description =
	'پشت صحنهٔ نگارش: حفاظت از داده‌های متن، بازبینی چندمرحله‌ای و رسم‌الخط فارسی برای تبدیل پیش‌نویس ماشینی به نثری طبیعی و قابل اعتماد.';
export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: '/how-it-works' },
	openGraph: { title, description, type: 'website', locale: 'fa_IR', siteName: 'نگارش', url: '/how-it-works' },
	twitter: { card: 'summary_large_image', title, description, images: ['/how-it-works/opengraph-image'] },
};
export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#09090b' };

const questions = [
	{
		question: 'آیا آمار، ارقام و اطلاعات متن من تغییر می‌کنند؟',
		answer: 'سیستم قبل از شروع بازنویسی، تمام عددها، درصدها، لینک‌ها، کدها و نام‌های خاص را قفل می‌کند. ما فقط لحن و ساختار جملات را روان و انسانی می‌کنیم، نه محتوای اطلاعات را. با این حال، مثل هر ویراستار حرفه‌ای، پیشنهاد می‌کنیم قبل از انتشار نهایی یک نگاه سریع به خروجی داشته باشید.',
	},
	{
		question: 'خروجی نگارش چطور توسط ابزارهای تشخیص AI ارزیابی می‌شود؟',
		answer: 'هدف ما فریب دادن دیتکتورها با ترفندهای ارزان نیست؛ هدف جلب اعتماد خواننده و موتورهای جستجوست. ابزارهای ضدجعل متونی را علامت می‌زنند که ریتم ماشینی، جملات هم‌اندازه و کلمات نخ‌ نما دارند. "نگارش" با شکستن این یکنواختی، اصلاح نیم‌فاصله‌ها و تزریق جریان زنده به نثر، نوشته‌ای تولید می‌کند که طبیعی خوانده شود، ماندگاری کاربر را بالا ببرد و طبق استانداردهای واقعی وب رتبه بگیرد.',
	},
];

export default function HowItWorks() {
	return (
		<div className={styles.page}>
			<a className={styles.skip} href='#learn-content'>
				رفتن به محتوای صفحه
			</a>
			<header className={styles.header}>
				<nav className={styles.nav} aria-label='ناوبری اصلی'>
					<Link href='/' aria-label='نگارش، صفحهٔ اصلی'>
						<Image src={logo} alt='نگارش' className={styles.logo} priority />
					</Link>
					<Link href='/' className={styles.back}>
						بازگشت به ویرایشگر
						<ArrowLeft size={15} aria-hidden='true' />
					</Link>
				</nav>
			</header>
			<main id='learn-content' className={styles.main}>
				<section className={styles.hero} aria-labelledby='hero-title'>
					<h1 id='hero-title'>
						مهندسی کلمات؛
						<br />
						<span>فراتر از یک بازنویسی ساده.</span>
					</h1>
					<p>
						در عوض ساعت‌ ها کلنجار رفتن با خروجی‌های تکراری هوش مصنوعی، متن خام را تحویل دهید و نسخه‌ای
						حرفه‌ای و روان تحویل بگیرید؛ آماده انتشار برای وبلاگ، شبکه‌های اجتماعی و سئو
					</p>
					<div className={styles.pipeline} aria-label='مراحل پردازش متن'>
						<span>
							<ScanText size={16} aria-hidden='true' />
							پیش‌نویس شما
						</span>
						<ArrowLeft aria-hidden='true' size={14} />
						<span>
							<LockKeyhole size={16} aria-hidden='true' />
							حفاظت از داده‌ها
						</span>
						<ArrowLeft aria-hidden='true' size={14} />
						<span>
							<GitBranch size={16} aria-hidden='true' />
							بازبینی تحریریه
						</span>
						<ArrowLeft aria-hidden='true' size={14} />
						<span>
							<Fingerprint size={16} aria-hidden='true' />
							نثر طبیعی فارسی
						</span>
					</div>
				</section>

				<section id='architecture' className={styles.section} aria-labelledby='architecture-title'>
					<div className={styles.sectionHead}>
						<div>
							<span className={styles.eyebrow}>معماری نگارش</span>
							<h2 id='architecture-title'>سه لایه، یک متن منسجم.</h2>
						</div>
					</div>
					<div className={styles.cards}>
						<article className={styles.card}>
							<div className={styles.cardTop}>
								<LockKeyhole size={23} aria-hidden='true' />
								<span>01</span>
							</div>
							<h3>حفظ آمار و داده‌ها</h3>
							<p>
								پیش از بازنویسی، داده‌های حساس شناسایی می‌شوند. اعداد، درصدها و نام‌های انگلیسی با متن
								اصلی تطبیق می‌یابند؛ لینک‌ها و بلوک‌های کد نیز جداگانه محافظت می‌شوند. تغییر لحن باعث
								تغییر اطلاعات نمی‌شود.
							</p>
							<div className={styles.cardFoot}>
								<ShieldCheck size={15} aria-hidden='true' />
								کنترل قاعده‌محور، فراتر از دستور به مدل
							</div>
						</article>
						<article className={styles.card}>
							<div className={styles.cardTop}>
								<GitBranch size={23} aria-hidden='true' />
								<span>02</span>
							</div>
							<h3>اتاق تحریریه مجازی؛ حذف کلیشه‌ها</h3>
							<p>
								نوشتن، نقدکردن و پرداخت نهایی نقش‌های جداگانه دارند. منتقد تحریریه، کلیشه‌های ماشینی،
								ضرباهنگ یکنواخت و گسست میان جمله‌ها را بررسی می‌کند؛ سپس ویرایش هدفمند، بخش‌های نیازمند
								اصلاح را صیقل می‌دهد.
							</p>
							<div className={styles.cardFoot}>
								<Check size={15} aria-hidden='true' />
								هر مرحله، مسئول یک بخش از کیفیت
							</div>
						</article>
						<article className={styles.card}>
							<div className={styles.cardTop}>
								<Fingerprint size={23} aria-hidden='true' />
								<span>03</span>
							</div>
							<h3>
								استانداردسازی رسم‌الخط و الگوی <bdi>E-E-A-T</bdi>
							</h3>
							<p>
								نیم‌فاصله، نشانه‌گذاری و تنوع طول جمله‌ها به خواندن طبیعی کمک می‌کنند. توجه به تجربه،
								تخصص، اعتبار و اعتماد، متن را به سوی محتوای مفید هدایت می‌کند؛ بدون ساختن تجربه، منبع یا
								ادعای تازه.
							</p>
							<div className={styles.cardFoot}>
								<Check size={15} aria-hidden='true' />
								کیفیت برای خواننده، بدون ترفند ظاهری
							</div>
						</article>
					</div>
				</section>

				<section className={styles.section} aria-labelledby='comparison-title'>
					<div className={styles.sectionHead}>
						<div>
							<span className={styles.eyebrow}>تفاوت در عمل</span>
							<h2 id='comparison-title'>همان اطلاعات، صدایی روشن‌ تر.</h2>
						</div>
						<p>سناریوی فرضی: خرید آنلاین هدفون</p>
					</div>
					<div className={styles.comparison}>
						<article className={styles.before}>
							<div className={styles.compareHead}>
								<span>
									<ScanText size={16} aria-hidden='true' />
									پیش‌نویس ماشینی
								</span>
								<span className={styles.smallLabel}>پیش از ویرایش</span>
							</div>
							<p>
								<mark>در دنیای امروز،</mark> مقایسهٔ قیمت پیش از خرید <mark>حائز اهمیت است.</mark>{' '}
								<mark>شایان ذکر است که</mark> در فروش ویژهٔ سال <bdi>۱۴۰۴</bdi>، هدفون‌های{' '}
								<bdi>Samsung</bdi> با <bdi>۲۰٪</bdi> تخفیف عرضه می‌شوند. امکان مقایسهٔ قیمت مدل‌ها برای
								خریداران فراهم شده است. ارسال رایگان نیز برای تمام سفارش‌ها در نظر گرفته شده است.
							</p>
							<div className={styles.compareFoot}>کلیشه‌های زائد · افعال مجهول اداری · ریتم یکنواخت</div>
						</article>
						<article className={styles.after}>
							<div className={styles.compareHead}>
								<span>
									<Fingerprint size={16} aria-hidden='true' />
									پس از ویرایش نگارش
								</span>
								<span className={styles.smallLabel}>بیان طبیعی‌تر</span>
							</div>
							<p>
								هدفون‌های <bdi className={styles.invariant}>Samsung</bdi> در فروش ویژهٔ سال{' '}
								<bdi className={styles.invariant}>۱۴۰۴</bdi>،{' '}
								<bdi className={styles.invariant}>۲۰٪</bdi> تخفیف دارند. پیش از خرید، قیمت مدل‌ها را
								مقایسه کنید. هزینهٔ ارسال؟ برای تمام سفارش‌ها رایگان است.
							</p>
							<div className={styles.compareFoot}>
								<ShieldCheck size={15} aria-hidden='true' />
								داده‌های ثابت · بیان فعال · ریتم متنوع
							</div>
						</article>
					</div>
					<p className={styles.caption}>
						در این پیش‌نمایش، عبارت‌های خط‌خورده کنار می‌روند و درصد، سال و نام برند عیناً حفظ می‌شوند.
						شیوهٔ ویرایش هر متن، متناسب با محتوا و لحن آن شکل می‌گیرد.
					</p>
				</section>

				<section className={`${styles.section} ${styles.faq}`} aria-labelledby='faq-title'>
					<div>
						<span className={styles.eyebrow}>استانداردهای شفاف</span>
						<h2 id='faq-title'>پاسخ‌های روشن به دغدغه‌های شما.</h2>
						<p className={styles.faqIntro}>سازوکار نگارش، مسئولیت ما و تعهدی که به نوشته‌های شما داریم.</p>
					</div>
					<div>
						{questions.map(({ question, answer }) => (
							<details key={question} className={styles.question}>
								<summary>
									{question}
									<ChevronDown size={17} aria-hidden='true' />
								</summary>
								<p>{answer}</p>
							</details>
						))}
					</div>
				</section>
			</main>
			<footer className={styles.footer}>
				<span>
					نگارش <span className={styles.footerDivider}>/</span> مهندسی متن، با احترام به معنا.
				</span>
				<Link href='/'>
					بازگشت به ویرایشگر
					<ArrowLeft size={14} aria-hidden='true' />
				</Link>
			</footer>
		</div>
	);
}
