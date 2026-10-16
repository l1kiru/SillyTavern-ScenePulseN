// Explicit markers shared by extraction, token accounting and display filtering.
export const SP_MARKER_START = '<!--SP_TRACKER_START-->';
export const SP_MARKER_END = '<!--SP_TRACKER_END-->';
export const TRACKER_MARKER_PAIRS = [
    [SP_MARKER_START, SP_MARKER_END],
    ['{{//SP_TRACKER_START}}', '{{//SP_TRACKER_END}}'],
    ['{{SP_TRACKER_START}}', '{{SP_TRACKER_END}}'],
    ['[SP_TRACKER_START]', '[SP_TRACKER_END]'],
    ['**SP_TRACKER_START**', '**SP_TRACKER_END**'],
];
