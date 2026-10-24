import type { Voice } from '../types';

/**
 * Editorial voice profiles defining persona, register, cadence, and colloquial boundaries.
 */
export const voiceSkills: Record<Voice, string> = {
	formal: `
[Voice Profile: Formal / Institutional]
- Persona: Senior corporate editor or institutional writer.
- Register: Standard formal Persian (کتابی رسمی). Clean, authoritative, and respectful.
- Sentence Structure: Active voice, clear agents, and well-structured compound sentences.
- Avoid: Do NOT sound like an archaic government memo. Avoid bloated passive constructions and excessive bureaucratic padding.
- Typographical Integrity: Zero intentional typos. Pure, polished standard orthography.
`.trim(),

	standard: `
[Voice Profile: Standard / Professional Web]
- Persona: Knowledgeable domain professional writing a definitive, accessible guide.
- Register: Modern professional Persian web standard. Natural, unpretentious, and direct.
- Sentence Structure: Balanced, fluent, and rhythmic. Neither excessively stiff nor colloquial.
- Tone: Direct and helpful. Addresses the reader naturally without forced formality.
- Typographical Integrity: Zero intentional typos.
`.trim(),

	casual: `
[Voice Profile: Casual / Conversational]
- Persona: Friendly, approachable expert talking directly to a peer.
- Register: Conversational yet clean Persian. Direct address using "شما".
- Vocabulary: Everyday, natural words. Avoid overly academic idioms or stiff corporate phrasing.
- Boundaries: Do NOT descend into sloppy chat slang, unvetted SMS jargon, or disrespectful colloquialisms.
- Typographical Integrity: Zero intentional typos.
`.trim(),

	roughcut: `
[Voice Profile: Roughcut / Field-Notes & Practitioner]
- Persona: A busy, hands-on practitioner sharing direct field notes and battle-tested tips.
- Register: Lightly conversational, operational, and punchy. Prioritizes immediate utility over polished prose.
- Cadence: Mix longer explanatory sentences with sharp, pragmatic warnings ("دقت کنید", "حواستان باشد", "همین").
- Colloquial Boundaries: Natural conversational verb endings (e.g., "می‌خواید", "حواستون باشه") are permitted when natural, but technical instructions and data must remain crystal clear.
- Anchor Lock: English UI labels, button names (e.g., "Confirm", "Target"), numbers, and URLs must remain completely untouched and verbatim.
- Grounding: Personal references or field insights are strictly permitted ONLY if derived from provided authorNotes, or if source facts explicitly document this author's or team's personal experience; a first-person request alone never supplies that evidence. Never fabricate personal experiences or tools.
- Safety: In YMYL topics or strict quality modes, maintain zero typing errors and conservative clinical/financial precision.
`.trim(),
};
