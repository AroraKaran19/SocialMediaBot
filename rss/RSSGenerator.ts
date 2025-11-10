import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Browser, BrowserContext, Page } from "puppeteer";
import dotenv from "dotenv";
import mongoose, { Collection } from "mongoose";
import fs from "fs";
import path from "path";
dotenv.config();

const mongoUri = process.env.MONGODB_URI!;
let collection: Collection | null = null;

const connect = async () => {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  collection = db?.collection("proxy") as Collection;
};

const disconnect = async () => {
  await mongoose.connection.close();
};

interface Tweet {
  id: string;
  text: string;
  author: string;
  authorDisplayName: string;
  authorUrl: string;
  tweetUrl: string;
  date: string;
  replies: string;
  reposts: string;
  likes: string;
  views: string;
}

class RSSGenerator {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private type: "reddit" | "x" | "google" | null = null;
  private keyword: string;
  private xmlFilePath: string;
  private processedTweetIds: Set<string> = new Set();

  constructor(type: "reddit" | "x" | "google", keyword: string) {
    this.type = type;
    this.keyword = keyword;
    this.xmlFilePath = path.join(
      process.cwd(),
      `rss_${keyword}_${Date.now()}.xml`
    );
  }

  async init() {
    if (this.type !== "x")
      throw new Error("Only in case of x scrapping is used!");
    const proxyUrl = await this.getProxy();
    if (!proxyUrl) {
      throw new Error("No proxy found");
    }
    this.browser = await puppeteer.launch({
      headless: false,
      userDataDir: "./userDataX",
      // args: [`--proxy-server=${proxyUrl.proxyUrl}`],
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
    await this.page?.goto(
      `https://x.com/search?q=${encodeURIComponent(
        this.keyword
      )}&src=typed_query&f=live`,
      { timeout: 60000 }
    );

    console.log("📌 Switching to Top tab...");
    try {
      await this.page?.waitForSelector('nav[role="navigation"] a[role="tab"]', {
        timeout: 10000,
      });

      await this.page?.evaluate(() => {
        const tabs = Array.from(
          document.querySelectorAll('nav[role="navigation"] a[role="tab"]')
        );
        const topTab = tabs.find((tab) => {
          const text = tab.textContent?.trim();
          const href = tab.getAttribute("href") || "";
          return (
            text === "Top" &&
            href.includes("src=typed_query") &&
            !href.includes("f=")
          );
        });
        if (topTab) {
          (topTab as HTMLElement).click();
          return true;
        }
        return false;
      });

      console.log("✅ Clicked on Top tab");

      await this.page?.waitForNetworkIdle({ timeout: 30000, concurrency: 3 });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.log(`❌ Could not switch to Top tab: ${error}`);
    }

    // Initialize XML file
    this.initializeXMLFile();

    // Start scraping tweets
    await this.scrapeTweets();
  }

  private initializeXMLFile() {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Twitter Search: ${this.keyword}</title>
    <link>https://x.com/search?q=${encodeURIComponent(this.keyword)}</link>
    <description>Tweets from search: ${this.keyword}</description>
  </channel>
</rss>`;
    fs.writeFileSync(this.xmlFilePath, xmlHeader, "utf-8");
    console.log(`📄 Created XML file: ${this.xmlFilePath}`);
  }

  private async extractTweets(): Promise<Tweet[]> {
    if (!this.page) return [];

    const tweets = await this.page.evaluate(() => {
      const tweetElements = Array.from(
        document.querySelectorAll('article[data-testid="tweet"]')
      );

      return tweetElements.map((tweetEl) => {
        // Extract tweet text
        const tweetTextEl = tweetEl.querySelector('[data-testid="tweetText"]');
        const text = tweetTextEl?.textContent?.trim() || "";

        // Extract author username - find link that's not status or analytics
        const usernameLink = Array.from(
          tweetEl.querySelectorAll('a[href^="/"]')
        ).find((link) => {
          const href = link.getAttribute("href") || "";
          return (
            href &&
            !href.includes("/status/") &&
            !href.includes("/analytics") &&
            href.split("/").length === 2
          );
        }) as HTMLElement;
        const authorUrl = usernameLink?.getAttribute("href") || "";
        const author = authorUrl.replace("/", "") || "";

        // Extract display name from User-Name section
        const displayNameEl = tweetEl.querySelector(
          '[data-testid="User-Name"]'
        );
        const nameSpans = displayNameEl?.querySelectorAll("span");
        const authorDisplayName = nameSpans?.[0]?.textContent?.trim() || author;

        // Extract tweet URL and ID
        const tweetLink = tweetEl.querySelector(
          'a[href*="/status/"]'
        ) as HTMLElement;
        const tweetUrl = tweetLink?.getAttribute("href") || "";
        const tweetId = tweetUrl.split("/status/")[1]?.split("/")[0] || "";

        // Extract date
        const timeEl = tweetEl.querySelector("time");
        const date =
          timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || "";

        // Extract engagement metrics - look for spans with numbers
        const replyButton = tweetEl.querySelector('[data-testid="reply"]');
        const replies =
          replyButton
            ?.querySelector(
              'span[data-testid="app-text-transition-container"] span'
            )
            ?.textContent?.trim() || "0";

        const retweetButton = tweetEl.querySelector('[data-testid="retweet"]');
        const reposts =
          retweetButton
            ?.querySelector(
              'span[data-testid="app-text-transition-container"] span'
            )
            ?.textContent?.trim() || "0";

        const likeButton = tweetEl.querySelector('[data-testid="like"]');
        const likes =
          likeButton
            ?.querySelector(
              'span[data-testid="app-text-transition-container"] span'
            )
            ?.textContent?.trim() || "0";

        const viewsLink = tweetEl.querySelector('a[href*="/analytics"]');
        const views =
          viewsLink
            ?.querySelector(
              'span[data-testid="app-text-transition-container"] span'
            )
            ?.textContent?.trim() || "0";

        return {
          id: tweetId,
          text,
          author,
          authorDisplayName,
          authorUrl: authorUrl ? `https://x.com${authorUrl}` : "",
          tweetUrl: tweetUrl ? `https://x.com${tweetUrl}` : "",
          date,
          replies,
          reposts,
          likes,
          views,
        };
      });
    });

    // Filter out duplicates and invalid tweets
    return tweets.filter(
      (tweet) => tweet.id && tweet.text && !this.processedTweetIds.has(tweet.id)
    );
  }

  private appendTweetsToXML(tweets: Tweet[]) {
    if (tweets.length === 0) return;

    // Read current XML
    let xmlContent = fs.readFileSync(this.xmlFilePath, "utf-8");

    // Remove closing tags
    xmlContent = xmlContent.replace("  </channel>\n</rss>", "");

    // Add new items
    const itemsXML = tweets
      .map((tweet) => {
        const escapedText = this.escapeXML(tweet.text);
        const escapedAuthor = this.escapeXML(tweet.authorDisplayName);
        return `    <item>
      <title>${escapedAuthor}: ${escapedText.substring(0, 100)}${
          escapedText.length > 100 ? "..." : ""
        }</title>
      <link>${tweet.tweetUrl}</link>
      <description><![CDATA[${tweet.text}]]></description>
      <author>${tweet.author}</author>
      <pubDate>${tweet.date}</pubDate>
      <guid isPermaLink="true">${tweet.tweetUrl}</guid>
      <tweetId>${tweet.id}</tweetId>
      <replies>${tweet.replies}</replies>
      <reposts>${tweet.reposts}</reposts>
      <likes>${tweet.likes}</likes>
      <views>${tweet.views}</views>
    </item>`;
      })
      .join("\n");

    xmlContent += itemsXML + "\n  </channel>\n</rss>";

    // Write back
    fs.writeFileSync(this.xmlFilePath, xmlContent, "utf-8");
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private async randomDelay(min: number, max: number) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private async scrollToBottom() {
    if (!this.page) return;

    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await this.randomDelay(2000, 4000);
    await this.page?.waitForNetworkIdle({ timeout: 15000, concurrency: 3 });
  }

  private async scrapeTweets() {
    if (!this.page) return;

    const targetTweetCount = 50;
    console.log(
      `🔍 Starting to scrape tweets (target: ${targetTweetCount})...`
    );

    let consecutiveNoNewTweets = 0;
    const maxConsecutiveNoNewTweets = 5;

    try {
      await this.page.waitForSelector('article[data-testid="tweet"]', {
        timeout: 10000,
      });
    } catch (error) {
      console.log("⚠️ No tweets found on initial load");
      return;
    }

    console.log("📥 Extracting initially rendered tweets...");
    let tweets = await this.extractTweets();
    const newTweets = tweets.filter(
      (tweet) => !this.processedTweetIds.has(tweet.id)
    );

    if (newTweets.length > 0) {
      const remaining = targetTweetCount - this.processedTweetIds.size;
      const tweetsToSave = newTweets.slice(0, remaining);

      tweetsToSave.forEach((tweet) => this.processedTweetIds.add(tweet.id));
      this.appendTweetsToXML(tweetsToSave);

      console.log(
        `✅ Saved ${tweetsToSave.length} initial tweet(s). Progress: ${this.processedTweetIds.size}/${targetTweetCount} tweets collected`
      );
    }

    while (this.processedTweetIds.size < targetTweetCount) {
      if (this.processedTweetIds.size >= targetTweetCount) {
        console.log(
          `✅ Target reached! Collected ${this.processedTweetIds.size} tweets`
        );
        break;
      }

      console.log("📜 Scrolling to bottom...");
      await this.scrollToBottom();

      console.log("📥 Extracting newly rendered tweets...");
      tweets = await this.extractTweets();

      const newTweetsAfterScroll = tweets.filter(
        (tweet) => !this.processedTweetIds.has(tweet.id)
      );

      if (newTweetsAfterScroll.length === 0) {
        console.log("⚠️ No new tweets found after scrolling");
        consecutiveNoNewTweets++;
        if (consecutiveNoNewTweets >= maxConsecutiveNoNewTweets) {
          console.log(
            "⚠️ No new tweets found after multiple scrolls. Stopping."
          );
          break;
        }
        await this.randomDelay(2000, 3000);
        continue;
      }

      consecutiveNoNewTweets = 0;

      const remaining = targetTweetCount - this.processedTweetIds.size;
      const tweetsToSave = newTweetsAfterScroll.slice(0, remaining);

      tweetsToSave.forEach((tweet) => this.processedTweetIds.add(tweet.id));

      this.appendTweetsToXML(tweetsToSave);

      console.log(
        `✅ Saved ${tweetsToSave.length} new tweet(s). Progress: ${this.processedTweetIds.size}/${targetTweetCount} tweets collected`
      );

      await this.randomDelay(2000, 4000);
    }

    console.log(
      `✅ Scraping complete! Total tweets: ${this.processedTweetIds.size}`
    );
    console.log(`📄 XML file saved at: ${this.xmlFilePath}`);
  }

  async getProxy() {
    const minUsageProxy = await collection?.findOne({}, { sort: { usage: 1 } });
    if (!minUsageProxy) {
      return null;
    }

    const minUsage = minUsageProxy.usage;

    const proxiesWithMinUsage = await collection
      ?.find({ usage: minUsage })
      .sort({ lastUsed: 1 })
      .toArray();

    if (!proxiesWithMinUsage || proxiesWithMinUsage.length === 0) {
      return null;
    }

    const oldestLastUsed = proxiesWithMinUsage[0]?.lastUsed ?? null;

    const proxiesWithOldestLastUsed = proxiesWithMinUsage.filter(
      (proxy) => (proxy.lastUsed ?? null) === oldestLastUsed
    );

    const randomIndex = Math.floor(
      Math.random() * proxiesWithOldestLastUsed.length
    );
    const selectedProxy = proxiesWithOldestLastUsed[randomIndex];

    await collection?.updateOne(
      { _id: selectedProxy._id },
      { $inc: { usage: 1 }, $set: { lastUsed: new Date() } }
    );

    return selectedProxy;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log("🔒 Browser closed");
    }
  }
}

(async () => {
  await connect();

  const rssGenerator = new RSSGenerator("x", "trending ai platform");
  try {
    await rssGenerator.init();
  } catch (error) {
    console.error("❌ Error during scraping:", error);
  } finally {
    await rssGenerator.close();
    await disconnect();
  }
})();
