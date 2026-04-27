export type RelevanceBucket = 'high' | 'medium' | 'low';

export interface Article {
  id: string;
  customerId: string;
  sourceId: string;
  title: string;
  url: string;
  teaser: string;
  discoveredAt: string;
  status: 'new' | 'ignored' | 'processing' | 'published';
  angle: string;
  reviewedAt: string | null;
  publishedAt: string | null;
  wordpressPostId: number | null;
  relevanceScore: number | null;
  relevanceBucket: RelevanceBucket | null;
  relevanceRationale: string | null;
  rankedAt: string | null;
}
