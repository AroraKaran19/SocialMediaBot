import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Browser, BrowserContext, Page } from "puppeteer";
import dotenv from "dotenv";
import mongoose, { Collection } from "mongoose";
dotenv.config();

const mongoUri = process.env.MONGODB_URI!;
let collection: Collection | null = null;

const connect = async () => {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  collection = db?.collection("proxy") as Collection;
  console.log("✅ Connected to MongoDB");
};

const disconnect = async () => {
  await mongoose.connection.close();
  console.log("🔒 Connection closed");
};

class RSSGenerator {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private type: "reddit" | "x" | "google" | null = null;

  constructor(type: "reddit" | "x" | "google") {
    this.type = type;
  }

  async init() {
    if (this.type !== "x")
      throw new Error("Only in case of x scrapping is used!");
    const proxyUrl = await this.getProxy();
    console.log(proxyUrl);
    if (!proxyUrl) {
      throw new Error("No proxy found");
    }
    this.browser = await puppeteer.launch({
      headless: false,
      args: [`--proxy-server=${proxyUrl.proxyUrl}`],
    });
    this.page = (await this.browser?.pages())[0];
    await this.page?.setUserAgent({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    await this.page?.authenticate({
      username: proxyUrl.proxyUsername,
      password: proxyUrl.proxyPassword,
    });
    await this.page?.goto("https://x.com/elonmusk", { timeout: 60000 });
  }

  async getProxy() {
    // First, find the minimum usage value
    const minUsageProxy = await collection?.findOne({}, { sort: { usage: 1 } });
    if (!minUsageProxy) {
      return null;
    }

    const minUsage = minUsageProxy.usage;

    // Find all proxies with the minimum usage, sorted by lastUsed (oldest first, null first)
    const proxiesWithMinUsage = await collection
      ?.find({ usage: minUsage })
      .sort({ lastUsed: 1 }) // 1 = ascending (null/oldest first)
      .toArray();

    if (!proxiesWithMinUsage || proxiesWithMinUsage.length === 0) {
      return null;
    }

    // Get the oldest lastUsed value (or null)
    const oldestLastUsed = proxiesWithMinUsage[0]?.lastUsed ?? null;

    // Filter proxies with the same oldest lastUsed (null values are treated as equal)
    const proxiesWithOldestLastUsed = proxiesWithMinUsage.filter(
      (proxy) => (proxy.lastUsed ?? null) === oldestLastUsed
    );

    // If only one proxy has the oldest lastUsed, return it
    // Otherwise, randomly select one from those with the same oldest lastUsed
    const randomIndex = Math.floor(
      Math.random() * proxiesWithOldestLastUsed.length
    );
    const selectedProxy = proxiesWithOldestLastUsed[randomIndex];

    // increase the count and lastUsed
    await collection?.updateOne(
      { _id: selectedProxy._id },
      { $inc: { usage: 1 }, $set: { lastUsed: new Date() } }
    );

    return selectedProxy;
  }
}

(async () => {
  await connect();

  const rssGenerator = new RSSGenerator("x");
  await rssGenerator.init();

  await disconnect();
})();
