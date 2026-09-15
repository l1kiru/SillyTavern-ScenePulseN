// Audience filters for character-scoped custom panels.
// Empty filter = every character. Named / gender / keyword groups are AND.

import { characterNameKey } from './character-identity.js';

export const CHARACTER_GENDER_OPTIONS = Object.freeze(['female', 'male', 'nonbinary']);

const FEMALE_RE = /^(f|female|woman|women|girl|girls|she|her|she\/her)$/;
const MALE_RE = /^(m|male|man|men|boy|boys|he|him|he\/him)$/;
const NONBINARY_RE = /^(nb|enby|nonbinary|non-binary|non binary|they|them|they\/them|other)$/;

export function normalizeGenderToken(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (FEMALE_RE.test(raw)) return 'female';
    if (MALE_RE.test(raw)) return 'male';
    if (NONBINARY_RE.test(raw)) return 'nonbinary';
    return raw;
}

function uniqueTrimmed(values, { lower = false, lowerKey = false, limit = 40 } = {}) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(values) ? values : []) {
        let item = String(raw || '').trim();
        if (lower) item = item.toLowerCase();
        if (!item) continue;
        const key = lowerKey ? item.toLowerCase() : item;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        if (out.length >= limit) break;
    }
    return out;
}

export function normalizeAudience(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        names: uniqueTrimmed(src.names, { lowerKey: true }),
        genders: uniqueTrimmed(
            uniqueTrimmed(src.genders, { lower: true }).map(normalizeGenderToken),
            { lower: true },
        ).filter(gender => CHARACTER_GENDER_OPTIONS.includes(gender)),
        keywords: uniqueTrimmed(src.keywords, { lower: true }),
    };
}

export function audienceIsOpen(audience) {
    const normalized = normalizeAudience(audience);
    return !normalized.names.length && !normalized.genders.length && !normalized.keywords.length;
}

export function audienceNeedsGender(audience) {
    return normalizeAudience(audience).genders.length > 0;
}

export function formatAudienceHint(audience) {
    const normalized = normalizeAudience(audience);
    if (audienceIsOpen(normalized)) return '';
    const parts = [];
    if (normalized.names.length) parts.push(`names ${normalized.names.join(', ')}`);
    if (normalized.genders.length) parts.push(`gender ${normalized.genders.join('/')}`);
    if (normalized.keywords.length) parts.push(`keywords ${normalized.keywords.join(', ')}`);
    return parts.join('; ');
}

function escapeKeyword(keyword) {
    return String(keyword || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordInText(haystack, keyword) {
    const needle = String(keyword || '').trim().toLowerCase();
    if (!needle) return false;
    // Unicode-aware whole word / whole phrase matching. `\b` is ASCII-centric
    // in JavaScript and treats Cyrillic as punctuation, while substring matching
    // makes `cat` match Catherine and `кот` match `который`. Keep letters,
    // combining marks, numbers and underscore as word characters on both sides.
    const phrase = escapeKeyword(needle).replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}_])${phrase}(?=$|[^\\p{L}\\p{M}\\p{N}_])`, 'iu').test(haystack);
}

function characterSearchText(character) {
    return [
        character?.name,
        ...(Array.isArray(character?.aliases) ? character.aliases : []),
        character?.role,
        character?.archetype,
        character?.gender,
        character?.sex,
        character?.notableDetails,
        character?.innerThought,
        character?.outfit,
        character?.face,
    ].map(value => String(value || '')).join(' ').toLowerCase();
}

export function inferCharacterGender(character) {
    const direct = normalizeGenderToken(character?.gender || character?.sex);
    if (CHARACTER_GENDER_OPTIONS.includes(direct)) return direct;
    const blob = characterSearchText(character);
    // Fallback only when the model omitted explicit gender. Use Unicode-aware
    // token boundaries so Russian pronouns work without substring false hits.
    const female = /(?:^|[^\p{L}\p{M}\p{N}_])(she|her|hers|herself|woman|girl|она|её|ее|ей|ней)(?=$|[^\p{L}\p{M}\p{N}_])/iu.test(blob);
    const male = /(?:^|[^\p{L}\p{M}\p{N}_])(he|him|his|himself|man|boy|он|его|ему|ним)(?=$|[^\p{L}\p{M}\p{N}_])/iu.test(blob);
    if (female && !male) return 'female';
    if (male && !female) return 'male';
    if (/(?:^|[^\p{L}\p{M}\p{N}_])(they|them|their|themselves|nonbinary|non-binary)(?=$|[^\p{L}\p{M}\p{N}_])/iu.test(blob) && !female && !male) return 'nonbinary';
    return '';
}

export function characterMatchesAudience(character, audience) {
    const normalized = normalizeAudience(audience);
    if (audienceIsOpen(normalized)) return true;
    if (!character || typeof character !== 'object') return false;

    if (normalized.names.length) {
        const keys = new Set([
            characterNameKey(character.name),
            ...(Array.isArray(character.aliases) ? character.aliases.map(characterNameKey) : []),
        ].filter(Boolean));
        const wanted = normalized.names.map(characterNameKey).filter(Boolean);
        if (!wanted.some(name => keys.has(name))) return false;
    }

    if (normalized.genders.length) {
        const gender = inferCharacterGender(character);
        if (!normalized.genders.includes(gender)) return false;
    }

    if (normalized.keywords.length) {
        const haystack = characterSearchText(character);
        if (!normalized.keywords.some(keyword => keywordInText(haystack, keyword))) return false;
    }

    return true;
}
