import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const alt = 'Nib — Persian prose rewriting and humanizing engine';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const vazirmatnBold = await readFile(join(process.cwd(), 'src/assets/fonts/Vazirmatn-Bold.ttf'));

const logoSvg = await readFile(join(process.cwd(), 'src/assets/logo-light.svg'));
const logoSrc = `data:image/svg+xml;base64,${logoSvg.toString('base64')}`;

export default async function Image() {
	return new ImageResponse(
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'space-between',
				backgroundColor: '#07080B',
				padding: '60px 80px',
				position: 'relative',
				fontFamily: 'Vazirmatn',
			}}
		>
			{/* Glow Background */}
			<div
				style={{
					position: 'absolute',
					top: '-10%',
					left: '25%',
					width: '500px',
					height: '300px',
					background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, rgba(0,0,0,0) 70%)',
				}}
			/>

			{/* Header */}
			<div
				style={{
					display: 'flex',
					width: '100%',
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				{}
				<img src={logoSrc} height={48} alt='Nib' />
				<div
					style={{
						display: 'flex',
						padding: '8px 18px',
						borderRadius: '999px',
						border: '1px solid rgba(255,255,255,0.15)',
						background: 'rgba(255,255,255,0.04)',
						color: '#94A3B8',
						fontSize: '14px',
						letterSpacing: '1px',
					}}
				>
					PERSIAN EDITORIAL ENGINE
				</div>
			</div>

			{/* Center Content */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					textAlign: 'center',
					gap: '16px',
				}}
			>
				<h1
					style={{
						fontSize: '54px',
						color: '#F8FAFC',
						margin: 0,
						lineHeight: 1.25,
						fontWeight: 700,
						maxWidth: '980px',
					}}
				>
					The end of soulless machine-written articles.
				</h1>
				<p
					style={{
						fontSize: '22px',
						color: '#94A3B8',
						margin: 0,
						lineHeight: 1.5,
						maxWidth: '850px',
						fontWeight: 700,
					}}
				>
					Precise Persian prose editing that keeps every fact, figure, and the writer&apos;s original rhythm.
				</p>
			</div>

			{/* Footer Badges */}
			<div
				style={{
					display: 'flex',
					gap: '24px',
					borderTop: '1px solid rgba(255,255,255,0.1)',
					width: '100%',
					paddingTop: '24px',
					justifyContent: 'center',
					color: '#CBD5E1',
					fontSize: '16px',
					fontWeight: 700,
				}}
			>
				<span>• Facts stay intact</span>
				<span style={{ color: '#475569' }}>|</span>
				<span>• E-E-A-T aligned</span>
				<span style={{ color: '#475569' }}>|</span>
				<span>• Standard orthography & half-spaces</span>
			</div>
		</div>,
		{
			...size,
			fonts: [
				{
					name: 'Vazirmatn',
					data: vazirmatnBold,
					style: 'normal',
					weight: 700,
				},
			],
		},
	);
}
