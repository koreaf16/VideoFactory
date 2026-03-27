/**
 * ============================================================
 *  Module: Comment Analysis Domain Types
 * ============================================================
 *
 *  Defines YouTube comment ingestion, clustering,
 *  and sentiment analysis result structures.
 *
 *  ┌──────────────────────────────────────────┐
 *  │  YouTube API                             │
 *  │  ┌────────────────────┐                  │
 *  │  │  YouTubeComment    │                  │
 *  │  │  author, text,     │                  │
 *  │  │  likes, sentiment  │                  │
 *  │  └────────┬───────────┘                  │
 *  └───────────┼──────────────────────────────┘
 *              │  N:1
 *  ┌───────────▼──────────────────────────────┐
 *  │       CommentCluster                     │
 *  │  theme, count, averageSentiment,         │
 *  │  topComments[]                           │
 *  └───────────┬──────────────────────────────┘
 *              │
 *              ▼
 *  ┌──────────────────────────────────────────┐
 *  │       SentimentResult                    │
 *  │  positive, negative, neutral, requests[] │
 *  └──────────────────────────────────────────┘
 *
 * ============================================================
 */

export interface YouTubeComment {
  readonly commentId: string;
  readonly epId: string;
  readonly author: string;
  readonly text: string;
  readonly likes: number;
  readonly publishedAt: Date;
  readonly clusterId?: string;
  readonly sentiment?: string;
}

export interface CommentCluster {
  readonly clusterId: string;
  readonly theme: string;
  readonly count: number;
  readonly averageSentiment: number;
  readonly topComments: string[];
}

export interface SentimentResult {
  readonly positive: number;
  readonly negative: number;
  readonly neutral: number;
  readonly requests: string[];
}
