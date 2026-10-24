import type { Metadata, Viewport } from 'next';
import GateForm from './GateForm';
import styles from './page.module.css';

export const metadata: Metadata = {
	title: 'ورود به نسخه خصوصی | نگارش',
	description: 'ورود به نسخهٔ آزمایشی خصوصی نگارش.',
	robots: { index: false, follow: false },
};
export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#09090b' };

export default function GatePage() {
	return (
		<main className={styles.page}>
			<section className={styles.card} aria-labelledby='gate-title'>
				<span className={styles.badge}>نسخه آزمایشی</span>
				<h1 id='gate-title'>ورود به نسخه خصوصی</h1>
				<p className={styles.subtitle}>لطفاً رمز دسترسی ارائه‌ شده را وارد کنید.</p>
				<GateForm />
			</section>
		</main>
	);
}
