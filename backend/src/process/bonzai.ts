import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.BONZAI_BASE_URL,
  apiKey: process.env.BONZAI_API_KEY || 'placeholder',
});

const MODEL = process.env.BONZAI_MODEL || 'gpt-4o';

export async function generateArticle(
  title: string,
  teaser: string,
  sourceUrl: string,
  angle: string
): Promise<string> {
  const prompt = `Du er journalist på et dansk videnskabsmedie. Skriv en artikel baseret på følgende:

Titel på kildeartiklen: ${title}
Teaser: ${teaser}
Kilde-URL: ${sourceUrl}
Redaktørens vinkel: ${angle}

Skriv artiklen på dansk. Returner ren HTML med <h1>, <p> og evt. <h2>-sektioner. Ingen \`\`\`html\`\`\` wrapper.`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0]?.message?.content ?? '';
}
