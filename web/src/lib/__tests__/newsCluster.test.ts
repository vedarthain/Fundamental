import { describe, it, expect } from "vitest";
import { cleanStockNews, dropDisplayHeadline, isMarketProgressHeadline } from "@/lib/newsCluster";

describe("dropDisplayHeadline", () => {
  it("drops buy tips, GMP tickers and progress lists", () => {
    const drop = [
      "5 stocks to buy this week",
      "IPO GMP Today: NSE vs Jindal Supreme",
      "Should you subscribe to Hero Motors IPO?",
      "Nifty prediction, target 2026",
      "Stocks to watch today: TCS, Infosys",
      "Top gainers today",
      "HDFC Bank share price live update",
      "Buy or sell: what should you do with Infosys",
      "Stock Market Live: Nifty Above 23,300, Sensex Up 180 Points",
      "Rentomojo share price rises 44% above IPO price: What should investors watch now?",
      "2026’s Best IPO: 325% gain in 7 sessions",
      "Stocks in news: Tata Group, Wipro, BEL",
    ];
    for (const title of drop) {
      expect(dropDisplayHeadline(title, null), title).toBe(true);
    }
  });

  it("keeps real market and company stories", () => {
    const keep = [
      "TCS, Tata Chemicals, other Tata stocks tumble up to 8% as Tata Trusts calls Chandrasekaran’s tenure extension illegal",
      "NSE IPO fully subscribed on day 2; retail demand remains below 1x",
      "Manipal Health repays ₹5,310 crore debt with IPO proceeds",
      "Nestle India shares slip nearly 3% after FSSAI initiates legal action over infant nutrition products",
      "Sensex, Nifty gain as lower oil prices and global cues offset IT, Tata stocks drag",
      "Acme launches new plant; stock in focus",
      "A-One Steels India Fixes Rs 385 To Rs 405 Per Share Price Band For Rs 405 Crore IPO",
    ];
    for (const title of keep) {
      expect(dropDisplayHeadline(title, null), title).toBe(false);
    }
  });

  it("drops share-price tickers only on the Market lane", () => {
    expect(
      isMarketProgressHeadline(
        "Up over 65% from IPO price! What is driving Glass Wall Systems share price?",
        null,
      ),
    ).toBe(true);
    expect(
      isMarketProgressHeadline(
        "Newly listed Karamtara Engineering share price rally continues: Stock jumps 7.4%",
        null,
      ),
    ).toBe(true);
    expect(
      isMarketProgressHeadline(
        "Nestle India share price falls 3%: FSSAI takes legal action over infant nutrition",
        null,
      ),
    ).toBe(true);
    // The Nestle line is progress-shaped, but enrich() only applies this
    // after classify === markets. A company-enforcement story stays.
    expect(
      dropDisplayHeadline(
        "Nestle India share price falls 3%: FSSAI takes legal action over infant nutrition",
        null,
      ),
    ).toBe(false);
  });
});

describe("cleanStockNews", () => {
  it("drops tips, keeps the first of a syndicated pair", () => {
    const rows = [
      { title: "5 stocks to buy this week" },
      { title: "TCS wins $2bn deal" },
      { title: "TCS wins $2bn deal!" },
      { title: "HDFC Bank share price live update" },
    ];
    expect(cleanStockNews(rows).map((r) => r.title)).toEqual(["TCS wins $2bn deal"]);
  });
});
