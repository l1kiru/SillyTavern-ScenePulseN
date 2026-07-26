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
    isTextCombinePromptPayload,
    promptInjectionOwnerMatches,
    serializePromptInjectionMeta,
    abortPromptInjection,
    _resetPromptInjectionModuleForTests,
} from '../src/generation/prompt-injection.js';
import {
    setInlineGenStartMs,
    setInlineGenerationContext,
    setLastPromptInjectionMetrics,
    getLastPromptInjectionMetrics,
    setActivePromptInjectionRun,
    setCurrentSnapshotMesIdx,
} from '../src/state.js';
import { currentChatKey } from '../src/message-fingerprint.js';
import { resolveSpContextFootprint, refreshSpContextFooter } from '../src/ui/update-panel.js';

function stubChat(chatId = 'chatA', characterId = 'char1') {
    const prev = globalThis.SillyTavern;
    globalThis.SillyTavern = {
        getContext() {
            return {
                groupId: '',
                characterId,
                chatId,
                ...(typeof prev?.getContext === 'function' ? {} : {}),
            };
        },
    };
    return currentChatKey();
}

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

// ── Footprint split: instructions vs previous-state JSON ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({
        text: 'INSTR BLOCK\n\nPREV_JSON_HERE',
        role: 'system',
        owner: { chatKey: 'ck', messageId: 1, swipeId: 0 },
        promptParts: {
            instructions: 'INSTR BLOCK\n\n',
            previousState: 'PREV_JSON_HERE',
        },
    });
    beginRequest('chat', plan);
    const payload = { messages: [{ role: 'system', content: plan.main.text + '\n' + plan.tail.text }] };
    assert.equal(materializePromptInjection(payload, plan).ok, true);
    assert.equal(verifyPromptInjection(payload, { authority: 'CHAT_COMPLETION_SETTINGS_READY', plan }).ok, true);
    const metrics = await commitVerifiedFootprint(plan, { tailFound: true });
    assert.ok(metrics.tokens.instructionsInput > 0);
    assert.ok(metrics.tokens.previousStateInput > 0);
    assert.ok(
        metrics.tokens.instructionsInput + metrics.tokens.previousStateInput
        <= metrics.tokens.mainInput,
    );
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
    const planVerified = plan.status === 'verified' && plan.verification?.main === 'verified';
    if (planVerified && promptInjectionOwnerMatches(plan, { chatKey: 'other', messageId: 99, swipeId: 0 })) {
        meta = serializePromptInjectionMeta(plan, 'verified');
    } else if (!isRecover) {
        const rt = getLastPromptInjectionMetrics();
        if (rt?.tokens?.totalInput > 0) meta = { tokens: rt.tokens };
    }
    assert.equal(meta, null);
}

// ── P1: owner match alone must not serialize pending plan as verified ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({
        text: 'pending',
        role: 'system',
        owner: { chatKey: 'ck', messageId: 7, swipeId: 0 },
    });
    beginRequest('chat', plan);
    assert.equal(promptInjectionOwnerMatches(plan, { chatKey: 'ck', messageId: 7, swipeId: 0 }), true);
    assert.notEqual(plan.status, 'verified');
    assert.notEqual(plan.verification.main, 'verified');
    const planVerified = plan.status === 'verified' && plan.verification?.main === 'verified';
    assert.equal(planVerified, false);
    // Mimic pipeline attach policy
    let attached = null;
    if (planVerified && promptInjectionOwnerMatches(plan, { chatKey: 'ck', messageId: 7, swipeId: 0 })) {
        attached = serializePromptInjectionMeta(plan, 'verified');
    }
    assert.equal(attached, null);
}

// ── P2: Separate meta must not show Together runtime SP Context badge ──
{
    _resetPromptInjectionModuleForTests();
    const key = stubChat('chatSep');
    setCurrentSnapshotMesIdx(-1);
    setInlineGenerationContext({ chatKey: key, mesIdx: 4, swipeId: 0 });
    setLastPromptInjectionMetrics({
        chatKey: key,
        messageId: 4,
        swipeId: 0,
        tokens: { mainInput: 200, tailInput: 10, totalInput: 210, estimateSource: 'heuristic' },
        integrity: { main: 'verified', tail: 'verified', hook: 'x' },
    });
    assert.equal(
        resolveSpContextFootprint({ injectionMethod: 'separate' }),
        null,
    );
    // Historical Together badge on its own promptInjection still wins
    const hist = resolveSpContextFootprint({
        injectionMethod: 'separate',
        promptInjection: {
            tokens: { mainInput: 50, tailInput: 5, totalInput: 55, estimateSource: 'heuristic' },
        },
    });
    assert.equal(hist.totalInput, 55);
}

// ── Footer refresh from runtime metrics with no snapshot ──
{
    _resetPromptInjectionModuleForTests();
    const key = stubChat('chatLive');
    setCurrentSnapshotMesIdx(-1);
    setInlineGenerationContext({ chatKey: key, mesIdx: 3, swipeId: 0 });
    setLastPromptInjectionMetrics({
        chatKey: key,
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

// ── P0 ordered CC: empty combine ignored → chat materialize → settings verify ──
{
    _resetPromptInjectionModuleForTests();
    let stopCalls = 0;
    globalThis.SillyTavern = {
        getContext() {
            return { stopGeneration() { stopCalls += 1; } };
        },
    };

    const plan = buildPromptInjectionPlan({
        text: 'ORDERED CC BODY',
        role: 'system',
        owner: { chatKey: 'ck', messageId: 11, swipeId: 0 },
    });
    beginRequest(null, plan);
    setActivePromptInjectionRun(plan);
    setInlineGenStartMs(1);
    setInlineGenerationContext({ chatKey: 'ck', mesIdx: 11, swipeId: 0 });

    // 1) ST OpenAI noise — must not claim text / materialize / abort
    const emptyCombine = { prompt: '', dryRun: false };
    assert.equal(isTextCombinePromptPayload(emptyCombine), false);
    assert.equal(plan.currentRequest.apiKind, null);
    // Mimic index.js: early return — do not assign apiKind or materialize
    if (isTextCombinePromptPayload(emptyCombine)) {
        plan.currentRequest.apiKind = 'text';
        materializePromptInjection(emptyCombine, plan, { expectedApiKind: 'text' });
    }
    assert.equal(plan.currentRequest.apiKind, null);
    assert.equal(plan.currentRequest.phase, 'awaiting-intermediate');

    // 2) Chat prompt-ready
    const chatReady = {
        chat: [{ mes: plan.main.text + '\n' + plan.tail.text, is_system: true }],
        dryRun: false,
    };
    plan.currentRequest.apiKind = 'chat';
    const mat = materializePromptInjection(chatReady, plan, { expectedApiKind: 'chat' });
    assert.equal(mat.ok, true, mat.code);
    assert.equal(plan.currentRequest.phase, 'materialized');

    // 3) Settings-ready authority
    const settingsReady = {
        messages: [{ role: 'system', content: plan.main.text + '\n' + plan.tail.text }],
    };
    const ver = verifyPromptInjection(settingsReady, {
        authority: 'CHAT_COMPLETION_SETTINGS_READY',
        plan,
    });
    assert.equal(ver.ok, true, ver.code);
    assert.equal(plan.currentRequest.apiKind, 'chat');
    assert.equal(plan.currentRequest.phase, 'verified');
    assert.equal(stopCalls, 0);
    // Happy path must not abort
    assert.notEqual(plan.status, 'aborted');
}

// ── END digest corrupted (begin/inner OK) → materialize + verify fail ──
{
    _resetPromptInjectionModuleForTests();
    const plan = buildPromptInjectionPlan({ text: 'END DIGEST', role: 'system' });
    beginRequest('chat', plan);
    const badEnd = plan.main.text.replace(
        `<!--SP_PROMPT_END run="${plan.runId}" digest="${plan.main.digest}"-->`,
        `<!--SP_PROMPT_END run="${plan.runId}" digest="deadbeef00"-->`,
    );
    assert.ok(badEnd.includes('deadbeef00'));
    assert.ok(badEnd.includes(`digest="${plan.main.digest}"`)); // begin still good
    const payload = { messages: [{ role: 'system', content: badEnd + '\n' + plan.tail.text }] };
    const mat = materializePromptInjection(payload, plan);
    assert.equal(mat.ok, false);
    assert.equal(mat.fatal, true);
    assert.equal(mat.code, 'SP_PROMPT_DIGEST_MISMATCH');

    // Fresh plan already materialized with good markers, then verify sees bad END
    _resetPromptInjectionModuleForTests();
    const plan2 = buildPromptInjectionPlan({ text: 'END DIGEST 2', role: 'system' });
    beginRequest('chat', plan2);
    const good = { messages: [{ role: 'system', content: plan2.main.text + '\n' + plan2.tail.text }] };
    assert.equal(materializePromptInjection(good, plan2).ok, true);
    const badVerifyPayload = {
        messages: [{
            role: 'system',
            content: plan2.main.text.replace(
                `<!--SP_PROMPT_END run="${plan2.runId}" digest="${plan2.main.digest}"-->`,
                `<!--SP_PROMPT_END run="${plan2.runId}" digest="cafebabe01"-->`,
            ) + '\n' + plan2.tail.text,
        }],
    };
    const ver = verifyPromptInjection(badVerifyPayload, {
        authority: 'CHAT_COMPLETION_SETTINGS_READY',
        plan: plan2,
    });
    assert.equal(ver.ok, false);
    assert.equal(ver.fatal, true);
    assert.equal(ver.code, 'SP_PROMPT_DIGEST_MISMATCH');
}

// ── Authority markerless after materialize → fatal MISSING_MAIN ──
{
    _resetPromptInjectionModuleForTests();
    let stopCalls = 0;
    globalThis.SillyTavern = {
        getContext() {
            return { stopGeneration() { stopCalls += 1; } };
        },
    };
    const plan = buildPromptInjectionPlan({ text: 'MARKERLESS', role: 'system' });
    beginRequest('chat', plan);
    const good = { messages: [{ role: 'system', content: plan.main.text + '\n' + plan.tail.text }] };
    assert.equal(materializePromptInjection(good, plan).ok, true);
    const ver = verifyPromptInjection(
        { messages: [{ role: 'system', content: 'plain authority payload without SP markers' }] },
        { authority: 'CHAT_COMPLETION_SETTINGS_READY', plan },
    );
    assert.equal(ver.ok, false);
    assert.equal(ver.fatal, true);
    assert.equal(ver.code, 'SP_PROMPT_MISSING_MAIN');
    if (ver.fatal) {
        abortPromptInjection({ code: ver.code, runId: plan.runId, observed: ver.observed });
    }
    assert.equal(stopCalls, 1);
}

// ── Stale SP Context: chat-switch clear + owner/swipe gates ──
{
    _resetPromptInjectionModuleForTests();
    const keyA = stubChat('chatA');
    setCurrentSnapshotMesIdx(-1);
    setInlineGenerationContext({ chatKey: keyA, mesIdx: 2, swipeId: 0 });
    setLastPromptInjectionMetrics({
        chatKey: keyA,
        messageId: 2,
        swipeId: 0,
        tokens: { mainInput: 100, tailInput: 5, totalInput: 105, estimateSource: 'heuristic' },
        integrity: { main: 'verified', tail: 'verified', hook: 'x' },
    });
    assert.equal(resolveSpContextFootprint(null)?.totalInput, 105);

    // Simulate CHAT_CHANGED cleanup
    setLastPromptInjectionMetrics(null);
    setInlineGenerationContext(null);
    setInlineGenStartMs(0);
    assert.equal(resolveSpContextFootprint(null), null);

    // Runtime for chat A while viewing chat B
    const keyB = stubChat('chatB');
    setInlineGenerationContext({ chatKey: keyB, mesIdx: 2, swipeId: 0 });
    setLastPromptInjectionMetrics({
        chatKey: keyA,
        messageId: 2,
        swipeId: 0,
        tokens: { mainInput: 100, tailInput: 5, totalInput: 105, estimateSource: 'heuristic' },
    });
    assert.equal(resolveSpContextFootprint(null), null);

    // Matching viewed mes+swipe → ok
    stubChat('chatA');
    assert.equal(currentChatKey(), keyA);
    setInlineGenerationContext({ chatKey: keyA, mesIdx: 2, swipeId: 0 });
    setLastPromptInjectionMetrics({
        chatKey: keyA,
        messageId: 2,
        swipeId: 0,
        tokens: { mainInput: 100, tailInput: 5, totalInput: 105, estimateSource: 'heuristic' },
    });
    assert.equal(resolveSpContextFootprint(null)?.totalInput, 105);

    // Same mes, wrong swipe
    setInlineGenerationContext({ chatKey: keyA, mesIdx: 2, swipeId: 0 });
    setLastPromptInjectionMetrics({
        chatKey: keyA,
        messageId: 2,
        swipeId: 1,
        tokens: { mainInput: 100, tailInput: 5, totalInput: 105, estimateSource: 'heuristic' },
    });
    assert.equal(resolveSpContextFootprint(null), null);

    // Separate + runtime still hidden; historical promptInjection still shown
    assert.equal(resolveSpContextFootprint({ injectionMethod: 'separate' }), null);
    assert.equal(
        resolveSpContextFootprint({
            injectionMethod: 'separate',
            promptInjection: { tokens: { mainInput: 9, tailInput: 1, totalInput: 10 } },
        })?.totalInput,
        10,
    );
}

_resetPromptInjectionModuleForTests();
setInlineGenStartMs(0);
setInlineGenerationContext(null);
setCurrentSnapshotMesIdx(-1);
console.log('prompt-injection-lifecycle.test.mjs: all tests passed');
