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

export interface RelevanceBreakdown {
  kontraintuitiv_faktor: number;
  universalitet: number;
  forklarbarhed: number;
  nyhedsgrad: number;
  konkret_konsekvens: number;
  kildernes_trovaerdighed: number;
}

export type OaStatus = 'gold' | 'green' | 'hybrid' | 'bronze' | 'closed' | 'unknown';
export type ContentSourceType =
  | 'original_fulltext'
  | 'oa_fulltext'
  | 'original_abstract'
  | 'openalex_abstract'
  | 'crossref_abstract'
  | 'none';

export interface OpenAccessInfo {
  checked: boolean;
  checkedAt: string | null;
  doi: string | null;
  inOpenAlex: boolean;
  isOa: boolean;
  oaStatus: OaStatus | null;
  license: string | null;
  oaUrl: string | null;
  hasUsableFulltext: boolean;
  hasOpenAlexAbstract?: boolean;
  hasPublisherAbstract?: boolean;
  openalexType?: string | null;
  contentSourceType?: ContentSourceType;
  contentSourceUrl?: string | null;
  contentSourceHost?: string | null;
  contentTextLength?: number;
  canGenerate?: boolean;
}

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
  relevanceBreakdown: RelevanceBreakdown | null;
  relevanceSummary: string | null;
  relevanceAngle: string | null;
  rankedAt: string | null;
  openAccess?: OpenAccessInfo | null;
}

export interface CrawlResult {
  ok: boolean;
  added: number;
  errors: Array<{ sourceId: string; message: string }>;
  updatedAt: string;
}
