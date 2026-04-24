export interface Selectors {
  item: string;
  title: string;
  url: string;
  urlAttribute: string;
  teaser: string;
}

export interface SourceConfig {
  sourceId: string;
  customerId: string;
  name: string;
  startUrl: string;
  maxItems: number;
  enabled: boolean;
  type?: 'rss' | 'html';
  selectors?: Selectors;
}

export interface Customer {
  customerId: string;
  name: string;
}

export interface SourcesStore {
  updatedAt: string | null;
  customers: Customer[];
  sources: SourceConfig[];
}

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

export interface CrawlResult {
  ok: boolean;
  added: number;
  errors: Array<{ sourceId: string; message: string }>;
  updatedAt: string;
}
