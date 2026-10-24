'use client';

import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';
import styles from './page.module.css';

export default function GateForm() {
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const input = useRef<HTMLInputElement>(null);

	async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (pending) return;
		const secret = input.current?.value ?? '';
		if (!secret) return;
		setError(null);
		setPending(true);
		try {
			const response = await fetch('/api/auth-gate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ secret }),
			});
			const result: unknown = await response.json();
			if (
				response.ok &&
				typeof result === 'object' &&
				result !== null &&
				'success' in result &&
				result.success === true
			) {
				// Full navigation discards any unauthenticated router cache.
				const next = new URLSearchParams(window.location.search).get('next') ?? '/';
				window.location.replace(/^\/(?![\/\\])/.test(next) ? next : '/');
				return;
			}
			setError(
				response.status === 401 ? 'رمز ورود نامعتبر است' : 'ورود فعلاً امکان‌پذیر نیست. دوباره تلاش کنید.',
			);
		} catch {
			setError('ارتباط برقرار نشد. دوباره تلاش کنید.');
		}
		setPending(false);
		input.current?.focus();
		input.current?.select();
	}

	return (
		<form onSubmit={submit} className={styles.form} aria-busy={pending}>
			<label htmlFor='beta-secret'>رمز دسترسی</label>
			<input
				ref={input}
				id='beta-secret'
				name='secret'
				type='password'
				autoComplete='current-password'
				required
				maxLength={4096}
				readOnly={pending}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? 'gate-error' : undefined}
				onChange={() => {
					if (error) setError(null);
				}}
			/>
			<div className={styles.feedback} aria-live='polite' aria-atomic='true'>
				{error && (
					<p id='gate-error' className={styles.error}>
						{error}
					</p>
				)}
			</div>
			<button type='submit' disabled={pending}>
				{pending ? (
					<>
						در حال ورود
						<LoaderCircle size={16} className={styles.spinner} aria-hidden='true' />
					</>
				) : (
					<>
						ورود به برنامه
						<ArrowLeft size={16} aria-hidden='true' />
					</>
				)}
			</button>
		</form>
	);
}

