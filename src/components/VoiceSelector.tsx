'use client';

import { VOICES, type Voice } from '@/lib/types';

export const VOICE_LABELS: Record<Voice, string> = {
	formal: 'اداری',
	standard: 'استاندارد',
	casual: 'خودمانی',
	roughcut: 'دم‌دستی',
};

const VOICE_HELP: Record<Voice, string> = {
	formal: 'رسمی و روشن',
	standard: 'طبیعی و متعادل',
	casual: 'نزدیک به گفتار',
	roughcut: 'بی‌تکلف و اجرایی',
};

interface VoiceSelectorProps {
	value: Voice;
	onChange: (voice: Voice) => void;
	disabled?: boolean;
}

export default function VoiceSelector({ value, onChange, disabled }: VoiceSelectorProps) {
	return (
		<div className='grid grid-cols-2 gap-2 sm:grid-cols-4' role='group' aria-label='انتخاب لحن'>
			{VOICES.map(voice => (
				<button
					key={voice}
					type='button'
					disabled={disabled}
					onClick={() => onChange(voice)}
					aria-pressed={voice === value}
					className='voice-button'
				>
					<span className='block'>{VOICE_LABELS[voice]}</span>
					<span className='mt-1 block text-sm font-normal opacity-70'>{VOICE_HELP[voice]}</span>
				</button>
			))}
		</div>
	);
}
