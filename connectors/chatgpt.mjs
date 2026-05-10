/**
 * connectors/chatgpt.mjs — ChatGPT connector
 * Formats context for pasting into ChatGPT's custom instructions or system prompt.
 */

export const name    = 'chatgpt';
export const version = '0.1.0';

export function formatContext(block) {
  return `[CONTEXT FROM VIA]\n${block}\n[END CONTEXT]`;
}

export function formatPersona(persona) {
  return `You are ${persona.name}, ${persona.role}.\n\n${persona.system_prompt}`;
}

/** ChatGPT has no local footprint to detect — always returns false */
export function detect() { return false; }
