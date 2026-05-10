/**
 * connectors/langchain.mjs — LangChain connector
 * Returns context as a plain string suitable for SystemMessage or PromptTemplate injection.
 */

export const name    = 'langchain';
export const version = '0.1.0';

export function formatContext(block) { return block; }

export function formatPersona(persona) {
  return `Name: ${persona.name}\nRole: ${persona.role}\n\n${persona.system_prompt}`;
}

/**
 * Return a LangChain-compatible SystemMessage object (plain JS — no import required).
 */
export function toSystemMessage(block) {
  return { role: 'system', content: formatContext(block) };
}

export function detect() { return false; }
