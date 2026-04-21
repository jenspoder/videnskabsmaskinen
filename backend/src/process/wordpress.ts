const WP_URL = process.env.WORDPRESS_URL || '';
const WP_USER = process.env.WORDPRESS_USER || '';
const WP_APP_PASSWORD = process.env.WORDPRESS_APP_PASSWORD || '';

export async function createWordPressDraft(title: string, content: string): Promise<number> {
  const credentials = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

  const response = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({ title, content, status: 'draft' }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WordPress API fejl ${response.status}: ${text}`);
  }

  const post = (await response.json()) as { id: number };
  return post.id;
}
