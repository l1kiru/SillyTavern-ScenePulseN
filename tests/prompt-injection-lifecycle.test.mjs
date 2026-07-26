// tests/prompt-injection-lifecycle.test.mjs — P0/P1 Chat Completion + gating regressions
import assert from 'node:assert/strict';
import {
    buildPromptInjectionPlan,
    beginRequest,
    materializePromptInjection,
    verifyPromptInjection,
    commitVerifiedFootprint,
    extractPayloadTexts,
    extractMainBlock,
    extractMainInner,
    findEffectiveMainRole,
    shouldHandlePromptHook,
    promptInjectionOwnerMatches,
    serializePromptInjectionMeta,
    _resetPromptInjectionModuleForTests,
} from '../src/generation/prompt-injection.js';
import {
    setInlineGenStartMs,
    setInlineGenerationContext,
    setLastPromptInjectionMetrics,
    getLastPromptInjectionMetrics,
    setActivePromptInjectionRun,
} from '../src/state.js';
import { resolveSpContextFootprint, refreshSpContextFooter } from '../src/ui/update-panel.js';

function makeEl() {
    const el = {
        className: '',
        id: '',
        innerHTML: '',
        children: [],
        parent: null,
        querySelector(sel) {
            const cls = sel.startsWith('.') ? sel.slice(1) : null;
            if (!cls) return null;
            const stack = [...this.children];
            while (stack.length) {
                const c = stack.shift();
                if (String(c.className || '').split(/\s+/).includes(cls)) return c;
                if (c.children) stack.push(...c.children);
            }
            return null;
        },
        appendChild(child) {
            child.parent = this;
            this.children.push(child);
            return child;
        },
        insertAdjacentHTML(_pos, html) {
            const child = makeEl();
            const m = String(html).match(/class="([^"]+)"/);
            child.className = m ? m[1] : '';
            child.innerHTML = html;
            this.appendChild(child);
        },
        replaceWith(next) {
            if (!this.parent) return;
            const i = this.parent.children.indexOf(this);
            if (i >= 0) {
                this.parent.children[i] = next;
                next.parent = this.parent;
            }
        },
        firstElementChild: null,
    };
    Object.defineProperty(el, 'firstElementChild', {
        get() { return this.children[0] || null; },
    });
    return el;
}

_resetPromptInjectionModuleForTests();

// ── payload.chat extraction (ST CHAT_COMPLETION_PROMPT_READY shape) ──
{
    const texts = extractPayloadTexts({
        chat: [{ mes: 'hello from chat', is_system: true }],
        dryRun: false,
    });
    assert.deepEqual(texts, ['hello from chat']);
}

// ── Materialize from real CC prompt-ready { chat, dryRun:false } ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({
        text: 'CC MAIN BODY',
        role: 'system',
        owner: { chatKey: 'ck', messageId: 2, swipeId: 0 },
    });
    beginRequest(null, plan);
    plan.currentRequest.apiKind = 'chat';
    const payload = {
        chat: [{
            mes: plan.main.text + '\n' + plan.tail.text,
            is_system: true,
        }],
        dryRun: false,
    };
    assert.equal(findEffectiveMainRole(payload, plan.runId), 'system');
    const mat = materializePromptInjection(payload, plan, { expectedApiKind: 'chat' });
    assert.equal(mat.ok, true, mat.code);
    assert.ok(plan.materializedBlock);
    assert.ok(plan.materializedBlock.includes('SP_PROMPT_BEGIN'));
    assert.ok(plan.materializedBlock.includes('SP_PROMPT_END'));
    const inner = extractMainInner(plan.materializedBlock, plan.runId);
    assert.equal(inner, plan.materializedText);
    assert.ok(extractMainBlock(plan.materializedBlock, plan.runId).length > inner.length);
}

// ── Chat: SETTINGS_READY twice → one verify / verifiedRequestCount === 1 ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({ text: 'ONCE', role: 'system' });
    beginRequest(null, plan);
    plan.currentRequest.apiKind = 'chat';
    const payload = {
        chat: [{ mes: plan.main.text + '\n' + plan.tail.text, is_system: true }],
    };
    assert.equal(materializePromptInjection(payload, plan, { expectedApiKind: 'chat' }).ok, true);
    const v1 = verifyPromptInjection(payload, { authority: 'CHAT_COMPLETION_SETTINGS_READY', plan });
    assert.equal(v1.ok, true, v1.code);
    assert.equal(plan.verifiedRequestCount, 1);
    const v2 = verifyPromptInjection(payload, { authority: 'CHAT_COMPLETION_SETTINGS_READY', plan });
    assert.equal(v2.alreadyVerified, true);
    assert.equal(plan.verifiedRequestCount, 1);
    const vText = verifyPromptInjection(payload, { authority: 'GENERATE_AFTER_DATA', plan });
    assert.equal(vText.alreadyVerified, true);
    assert.equal(plan.verifiedRequestCount, 1);
}

// ── dryRun second arg / event flag → no handle ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({ text: 'DRY', role: 'system' });
    beginRequest('chat', plan);
    setActivePromptInjectionRun(plan);
    setInlineGenStartMs(1);
    setInlineGenerationContext({ chatKey: 'ck', mesIdx: 1, swipeId: 0 });
    assert.equal(shouldHandlePromptHook({ dryRun: true }, { requireApiKind: 'chat' }), false);
    assert.equal(shouldHandlePromptHook({}, { requireApiKind: 'chat', dryRunArg: true }), false);
    assert.equal(shouldHandlePromptHook({}, { requireApiKind: 'chat' }), true);
    assert.equal(shouldHandlePromptHook({}, { requireApiKind: 'text' }), false);
    setInlineGenStartMs(0);
    setInlineGenerationContext(null);
}

// ── Foreign payload without SP markers → NOT_OURS, non-fatal ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({ text: 'OURS', role: 'system' });
    beginRequest('chat', plan);
    const foreign = materializePromptInjection(
        { chat: [{ mes: 'plain ST quiet/raw prompt', is_user: true }] },
        plan,
        { expectedApiKind: 'chat' },
    );
    assert.equal(foreign.ok, false);
    assert.equal(foreign.fatal, false);
    assert.equal(foreign.code, 'SP_PROMPT_NOT_OURS');
}

// ── Footprint counts marker-wrapped main block (> inner-only heuristic) ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({
        text: 'TOKEN BODY',
        role: 'system',
        owner: { chatKey: 'ck', messageId: 9, swipeId: 0 },
    });
    beginRequest('chat', plan);
    const payload = { messages: [{ role: 'system', content: plan.main.text + '\n' + plan.tail.text }] };
    assert.equal(materializePromptInjection(payload, plan).ok, true);
    assert.equal(verifyPromptInjection(payload, { authority: 'CHAT_COMPLETION_SETTINGS_READY', plan }).ok, true);
    const metrics = await commitVerifiedFootprint(plan, { tailFound: true });
    const innerOnly = Math.round(plan.materializedText.length / 4);
    const blockOnly = Math.round(plan.materializedBlock.length / 4);
    assert.ok(blockOnly > innerOnly, `block ${blockOnly} should exceed inner ${innerOnly}`);
    assert.equal(metrics.tokens.mainInput, blockOnly);
    assert.ok(getLastPromptInjectionMetrics().tokens.totalInput >= metrics.tokens.mainInput);
}

// ── Pipeline-style owner match: swipe-recover must not take stale runtime ──
{
    _resetPromptInjectionModuleForTests();
    setLastPromptInjectionMetrics({
        chatKey: 'other-chat',
        messageId: 1,
        swipeId: 0,
        tokens: { mainInput: 999, tailInput: 1, totalInput: 1000, estimateSource: 'heuristic' },
        integrity: { main: 'verified', tail: 'verified', hook: 'x' },
    });
    const plan = buildPromptInjectionPlan({
        text: 'x',
        role: 'system',
        owner: { chatKey: 'live', messageId: 5, swipeId: 1 },
    });
    assert.equal(
        promptInjectionOwnerMatches(plan, { chatKey: 'live', messageId: 5, swipeId: 1 }),
        true,
    );
    assert.equal(
        promptInjectionOwnerMatches(getLastPromptInjectionMetrics(), {
            chatKey: 'live', messageId: 5, swipeId: 1,
        }),
        false,
    );
    const isRecover = true;
    let meta = null;
    if (promptInjectionOwnerMatches(plan, { chatKey: 'other', messageId: 99, swipeId: 0 })) {
        meta = serializePromptInjectionMeta(plan, 'verified');
    } else if (!isRecover) {
        const rt = getLastPromptInjectionMetrics();
        if (rt?.tokens?.totalInput > 0) meta = { tokens: rt.tokens };
    }
    assert.equal(meta, null);
}

// ── Footer refresh from runtime metrics with no snapshot ──
{
    _resetPromptInjectionModuleForTests();
    setInlineGenerationContext({ chatKey: 'ck', mesIdx: 3, swipeId: 0 });
    setLastPromptInjectionMetrics({
        chatKey: 'ck',
        messageId: 3,
        swipeId: 0,
        tokens: { mainInput: 80, tailInput: 5, totalInput: 85, estimateSource: 'heuristic' },
    });
    assert.equal(resolveSpContextFootprint(null).totalInput, 85);

    const body = makeEl();
    body.id = 'sp-panel-body';
    globalThis.document = {
        getElementById(id) { return id === 'sp-panel-body' ? body : null; },
        createElement() { return makeEl(); },
    };

    assert.equal(refreshSpContextFooter(), true);
    const footer = body.querySelector('.sp-gen-footer');
    assert.ok(footer);
    assert.ok(footer.querySelector('.sp-gen-badge-sp-context'));
}

_resetPromptInjectionModuleForTests();
setInlineGenStartMs(0);
setInlineGenerationContext(null);
console.log('prompt-injection-lifecycle.test.mjs: all tests passed');
