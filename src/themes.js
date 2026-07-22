// src/themes.js — Theme presets system
// Theme presets that swap ScenePulse CSS custom properties.

import { log } from './logger.js';

export const THEMES = {
    default: {
        name: 'Default',
        vars: {} // Uses variables.css defaults
    },
    sillytavern: {
        name: 'SillyTavern',
        vars: {
            // ST controls the neutral shell; ScenePulse keeps its semantic palette.
            // Quote/emphasis colors can be nearly grey in user themes and are not
            // suitable as the only accent or contrast source for a dense dashboard.
            '--sp-accent': '#4db8a4',
            '--sp-accent-dim': 'rgba(77,184,164,0.15)',
            '--sp-accent-glow': 'rgba(77,184,164,0.4)',
            '--sp-bg': 'color-mix(in srgb, var(--SmartThemeBlurTintColor) 86%, #101218)',
            '--sp-bg-solid': 'color-mix(in srgb, var(--SmartThemeBlurTintColor) 86%, #101218)',
            '--sp-surface': 'color-mix(in srgb, var(--SmartThemeBodyColor) 6%, var(--sp-bg-solid))',
            '--sp-surface-hover': 'color-mix(in srgb, var(--SmartThemeBodyColor) 11%, var(--sp-bg-solid))',
            '--sp-border': 'color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent)',
            '--sp-border-strong': 'color-mix(in srgb, var(--SmartThemeBodyColor) 18%, transparent)',
            '--sp-text': 'var(--SmartThemeBodyColor)',
            '--sp-text-dim': 'color-mix(in srgb, var(--SmartThemeBodyColor) 64%, transparent)',
            '--sp-text-bright': 'var(--SmartThemeBodyColor)',
            '--sp-font': 'var(--mainFontFamily)',
            '--sp-font-mono': 'var(--monoFontFamily)',
            '--sp-radius': '5px',
            '--sp-radius-lg': '10px',
        }
    },
    midnight: {
        name: 'Midnight',
        vars: {
            '--sp-accent': '#7b8ef8',
            '--sp-accent-dim': 'rgba(123,142,248,0.12)',
            '--sp-accent-glow': 'rgba(123,142,248,0.35)',
            '--sp-bg': 'rgba(10,12,20,0.96)',
            '--sp-surface': 'rgba(18,22,38,0.92)',
            '--sp-surface-hover': 'rgba(28,34,56,0.95)',
            '--sp-border': 'rgba(60,70,120,0.25)',
            '--sp-text': '#b0b8d4',
            '--sp-text-dim': '#5a6490',
            '--sp-text-bright': '#d4d8f0',
            '--sp-amber': '#c49a5e',
            '--sp-green': '#5bc47a',
            '--sp-purple': '#a07af8',
        }
    },
    fantasy: {
        name: 'Fantasy',
        vars: {
            '--sp-accent': '#d4a050',
            '--sp-accent-dim': 'rgba(212,160,80,0.12)',
            '--sp-accent-glow': 'rgba(212,160,80,0.35)',
            '--sp-bg': 'rgba(22,18,14,0.96)',
            '--sp-surface': 'rgba(34,28,20,0.92)',
            '--sp-surface-hover': 'rgba(48,40,30,0.95)',
            '--sp-border': 'rgba(100,80,50,0.25)',
            '--sp-text': '#c8bea8',
            '--sp-text-dim': '#7a6e58',
            '--sp-text-bright': '#e8dcc8',
            '--sp-amber': '#d4915e',
            '--sp-green': '#8ab45a',
            '--sp-purple': '#b48a6a',
        }
    },
    cyberpunk: {
        name: 'Cyberpunk',
        vars: {
            '--sp-accent': '#00f0e0',
            '--sp-accent-dim': 'rgba(0,240,224,0.10)',
            '--sp-accent-glow': 'rgba(0,240,224,0.35)',
            '--sp-bg': 'rgba(8,8,16,0.97)',
            '--sp-surface': 'rgba(16,16,32,0.92)',
            '--sp-surface-hover': 'rgba(24,24,48,0.95)',
            '--sp-border': 'rgba(0,200,180,0.15)',
            '--sp-text': '#a0c8d4',
            '--sp-text-dim': '#4a6878',
            '--sp-text-bright': '#d0f0f8',
            '--sp-amber': '#f08030',
            '--sp-green': '#30f080',
            '--sp-purple': '#d050f0',
        }
    },
    minimal: {
        name: 'Minimal',
        vars: {
            '--sp-accent': '#888',
            '--sp-accent-dim': 'rgba(136,136,136,0.10)',
            '--sp-accent-glow': 'rgba(136,136,136,0.2)',
            '--sp-bg': 'rgba(16,16,18,0.96)',
            '--sp-surface': 'rgba(24,24,28,0.92)',
            '--sp-surface-hover': 'rgba(34,34,40,0.95)',
            '--sp-border': 'rgba(80,80,90,0.2)',
            '--sp-text': '#a0a0a8',
            '--sp-text-dim': '#606068',
            '--sp-text-bright': '#d0d0d8',
            '--sp-amber': '#b8a080',
            '--sp-green': '#80b890',
            '--sp-purple': '#a090b8',
        }
    }
};

/**
 * Apply a theme to the ScenePulse panel.
 * @param {string} themeId — key from THEMES
 */
export function applyTheme(themeId) {
    const theme = THEMES[themeId] || THEMES.default;

    // Remove old theme style element
    const oldStyle = document.getElementById('sp-theme-style');
    if (oldStyle) oldStyle.remove();

    if (themeId === 'default' || !theme.vars) {
        log('Theme applied: default (reset)');
        return;
    }

    // ScenePulse variables are namespaced, so a body-level override safely reaches
    // the panel, settings drawer and any modal mounted outside either container.
    const varsCSS = Object.entries(theme.vars).map(([k, v]) => `${k}: ${v};`).join('\n    ');
    const style = document.createElement('style');
    style.id = 'sp-theme-style';
    style.textContent = `
body {
    ${varsCSS}
}`;
    document.head.appendChild(style);
    log('Theme applied:', themeId);
}
