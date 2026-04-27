import OpenAI from 'openai';
import {
  GENERATE_SYSTEM_PROMPT,
  buildGenerateUserMessage,
  GenerateUserMessageInput,
} from './generateArticlePrompt';

const client = new OpenAI({
  baseURL: process.env.BONZAI_BASE_URL,
  apiKey: process.env.BONZAI_API_KEY || 'placeholder',
});

const MODEL = process.env.BONZAI_MODEL || 'gpt-4o';

export interface GenerateOptions {
  signal?: AbortSignal;
}

/**
 * Genererer en populærvidenskabelig artikel ud fra en kilde og en
 * redaktionel vinkel. Returnerer ren HTML.
 *
 * Understøtter to opsætninger styret af BONZAI_MODEL:
 *
 *   Vej A: BONZAI_MODEL=claude-sonnet-4-5 (eller anden ren model)
 *   - BONZAI_BASE_URL skal pege på .../v1
 *   - Vi sender system-prompt fra generateArticlePrompt.ts
 *
 *   Vej B: BONZAI_MODEL=agent_xxx (en Bonzai-assistent)
 *   - BONZAI_BASE_URL skal pege på .../assistants
 *   - Vi sender KUN user-message; assistenten har sin egen instruction
 *     defineret i Bonzai-UI'en (og holdes i sync med generate-article.md
 *     som backup i Git).
 */
export async function generateArticle(
  input: GenerateUserMessageInput,
  options: GenerateOptions = {}
): Promise<string> {
  const userMessage = buildGenerateUserMessage(input);
  const isAssistant = MODEL.startsWith('agent_');

  const messages = isAssistant
    ? [{ role: 'user' as const, content: userMessage }]
    : [
        { role: 'system' as const, content: GENERATE_SYSTEM_PROMPT },
        { role: 'user' as const, content: userMessage },
      ];

  const response = await client.chat.completions.create(
    { model: MODEL, messages },
    { signal: options.signal }
  );

  const html = response.choices[0]?.message?.content?.trim() ?? '';
  return stripFences(html);
}

/**
 * Hvis modellen alligevel pakker output i ```html ... ```, så strippes
 * fences her - så Lambda altid returnerer ren HTML uanset.
 */
function stripFences(text: string): string {
  const fence = text.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : text;
}
