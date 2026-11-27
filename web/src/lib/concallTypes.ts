export type ConcallNumberItem = {
  metric: string;
  value: string;
  quote: string;
};

export type ConcallHighlightItem = {
  category: "Guidance" | "Demand" | "Margins" | "Capex" | "Order Book" | "Risk" | string;
  point: string;
  quote: string;
};

export type ConcallQaItem = {
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
