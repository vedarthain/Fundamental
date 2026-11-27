export type ConcallNumberItem = {
  segment?: string;
  metric: string;
  value: string;
  quote: string;
};

export type ConcallHighlightItem = {
  segment?: string;
  category: "Guidance" | "Demand" | "Margins" | "Capex" | "Order Book" | "Risk" | string;
  point: string;
  quote: string;
};

export type ConcallQaItem = {
  segment?: string;
  analyst?: string;
  topic: string;
  question: string;
  answer: string;
  quote: string;
};

export type ConcallDigest = {
  id: number;
  symbol: string;
  quarterLabel: string | null;
  publishedAt: string;
  pdfUrl: string | null;
  tone: "Optimistic" | "Neutral" | "Cautious";
  toneRationale: string | null;
  numbersMentioned: ConcallNumberItem[];
  highlights: ConcallHighlightItem[];
  qaHighlights: ConcallQaItem[];
  verifiedRatio: number;
};
