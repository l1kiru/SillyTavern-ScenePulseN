import { createPersonaGuard } from '../persona-guard.js';
import { currentChatKey } from '../message-fingerprint.js';
import { spConfirm } from '../utils.js';
import { t } from '../i18n.js';
import { warn } from '../logger.js';

let initialized = false;
let stopped = false;
let dispose = () => {};

export function disposePersonaGuard() { stopped = true; dispose(); }

export async function initPersonaGuard() {
    if (initialized || stopped) return;
    // Public exports in ST 1.18; optional import so missing API cannot break startup.
    const personas = await import('/scripts/personas.js');
    if (stopped || typeof personas.setUserAvatar !== 'function') return;
    initialized = true;
    const context = () => globalThis.SillyTavern.getContext();
    const guard = createPersonaGuard({
        read: () => {
            const ctx = context();
            return {
                chatKey: ctx.chatId != null ? currentChatKey() : '',
                metadata: ctx.chatMetadata,
                current: { avatarId: personas.user_avatar, name: ctx.name1 },
                personas: ctx.powerUserSettings?.personas ?? {},
                chat: ctx.chat,
            };
        },
        confirm: (previous, current) => spConfirm(
            t('Chat persona changed'),
            t('Previously used in this chat: {previous}. Currently selected: {current}. Restore the previous persona?',
                { previous: previous.name, current: current.name }),
            { okLabel: t('Restore previous persona'), cancelLabel: t('Continue with new persona'), danger: false },
        ),
        select: avatarId => personas.setUserAvatar(avatarId),
        save: () => context().saveMetadataDebounced(),
    });
    let timer;
    // Do not await dialogs inside ST's event bus. Core persona selection on
    // chat load must finish before we compare the effective current persona.
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { void guard.check().catch(e => warn('Persona check:', e)); }, 0);
    };
    const ctx = context();
    const types = ctx.eventTypes ?? ctx.event_types;
    const subscriptions = [];
    for (const name of ['CHAT_CHANGED', 'PERSONA_CHANGED', 'PERSONA_RENAMED', 'PERSONA_DELETED']) {
        if (types?.[name]) {
            ctx.eventSource.on(types[name], schedule);
            subscriptions.push(types[name]);
        }
    }
    dispose = () => {
        guard.dispose();
        clearTimeout(timer);
        for (const event of subscriptions) ctx.eventSource.removeListener(event, schedule);
    };
    schedule();
}
