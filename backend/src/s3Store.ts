import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Article } from './types';

const s3Client = new S3Client({});
const BUCKET = process.env.BUCKET || 'videnskabsmaskinen-articles';

export const SOURCES_KEY = 'articles/sources.json';

function articleKey(folder: 'inbox' | 'reviewed', id: string): string {
  return `articles/${folder}/${id}.json`;
}

export async function loadJsonOrDefault<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await response.Body?.transformToString();
    if (!body) return defaultValue;
    return JSON.parse(body) as T;
  } catch (error: any) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return defaultValue;
    }
    throw error;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
    })
  );
}

export async function saveArticle(article: Article): Promise<void> {
  const folder = article.status === 'new' ? 'inbox' : 'reviewed';
  await saveJson(articleKey(folder, article.id), article);
}

export async function loadArticle(
  id: string,
  folder: 'inbox' | 'reviewed'
): Promise<Article | null> {
  return loadJsonOrDefault<Article | null>(articleKey(folder, id), null);
}

export async function listArticlesInFolder(folder: 'inbox' | 'reviewed'): Promise<Article[]> {
  const prefix = `articles/${folder}/`;
  const listed = await s3Client.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  );

  if (!listed.Contents || listed.Contents.length === 0) return [];

  const articles = await Promise.all(
    listed.Contents.filter((obj) => obj.Key?.endsWith('.json')).map(async (obj) => {
      return loadJsonOrDefault<Article | null>(obj.Key!, null);
    })
  );

  return articles.filter((a): a is Article => a !== null);
}

export async function moveArticle(
  id: string,
  from: 'inbox' | 'reviewed',
  article: Article
): Promise<void> {
  const to = article.status === 'new' ? 'inbox' : 'reviewed';
  await saveJson(articleKey(to, id), article);
  if (from !== to) {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: articleKey(from, id) })
    );
  }
}
