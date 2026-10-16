// Per-chat persona choice. Dependencies keep ST/UI ownership at the boundary.
export function createPersonaGuard({ read, confirm, select, save }) {
    let revision = 0;
    let pending = '';
    let switching = false;
    let disposed = false;

    function remember(state, persona) {
        state.metadata.scenepulse ??= {};
        const previous = state.metadata.scenepulse.persona;
        if (previous?.avatarId === persona.avatarId && previous?.name === persona.name) return;
        state.metadata.scenepulse.persona = { ...persona };
        save();
    }

    function previousPersona(state) {
        const stored = state.metadata.scenepulse?.persona;
        if (stored?.avatarId) return stored;
        // Legacy chats have names, not reliable persona IDs. Ambiguous names
        // must never select an arbitrary avatar (personas may share a name).
        const message = state.chat?.findLast(m => m?.is_user && !m.is_system);
        const matches = Object.entries(state.personas).filter(([, name]) => name === message?.name);
        return matches.length === 1 ? { avatarId: matches[0][0], name: matches[0][1] } : null;
    }

    async function check() {
        if (disposed || switching) return; // setUserAvatar emits PERSONA_CHANGED itself.
        const state = read();
        if (!state?.chatKey || !state.metadata || !state.current?.avatarId) {
            revision++; pending = ''; return;
        }
        const identity = JSON.stringify([state.chatKey, state.current.avatarId]);
        const currentId = state.current.avatarId;
        if (pending === identity) return;
        const ticket = ++revision;
        pending = '';
        const previous = previousPersona(state);
        if (!previous || previous.avatarId === state.current.avatarId || !Object.hasOwn(state.personas, previous.avatarId)) {
            remember(state, state.current);
            return;
        }
        pending = identity;
        const stillCurrent = () => {
            const live = read();
            return revision === ticket && live?.chatKey === state.chatKey
                && live.metadata === state.metadata && live.current?.avatarId === currentId;
        };
        try {
            const restore = await confirm({ ...previous, name: state.personas[previous.avatarId] }, state.current);
            if (!stillCurrent()) return;
            if (restore) {
                if (!Object.hasOwn(read().personas, previous.avatarId)) return;
                switching = true;
                try { await select(previous.avatarId); } finally { switching = false; }
                const live = read();
                if (revision !== ticket || live?.chatKey !== state.chatKey || live.metadata !== state.metadata
                    || live.current?.avatarId !== previous.avatarId) return;
                remember(live, live.current);
            } else {
                remember(state, state.current);
            }
        } finally {
            if (revision === ticket) pending = '';
        }
    }

    return { check, dispose: () => { disposed = true; revision++; pending = ''; } };
}
