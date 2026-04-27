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
 * Prompt-tekst er defineret i ./generateArticlePrompt.ts og holdes i
 * sync med backend/prompts/generate-article.md (sandhedskilden for
 * Bonzai-assistenten i Bonzai-UI'en).
 */
export async function generateArticle(
  input: GenerateUserMessageInput,
  options: GenerateOptions = {}
): Promise<string> {
  const userMessage = buildGenerateUserMessage(input);

  const response = await client.chat.completions.create(
    {
      model: MODEL,
      messages: [
        { role: 'system', content: GENERATE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    },
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
