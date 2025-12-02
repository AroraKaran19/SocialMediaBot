import RSSGenerator from "../../rss/RSSGenerator";
import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import { encode } from "@toon-format/toon";

interface RSSConfig {
  searchKeywords: string[];
  queryCombinations?: string[];
}

interface ParsedItem {
  [key: string]: any;
}

interface MergedRSSData {
  platform: string;
  keyword: string;
  items: ParsedItem[];
}

// Helper functions from CleanData.ts
const cleanText = (text: string): string => {
  if (!text) return "";

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#32;/g, " ")
    .replace(/&nbsp;/g, " ");

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
};

const cleanHtmlContent = (html: string): string => {
  if (!html) return "";

  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  // Remove script and style tags
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Convert <br> and <p> to newlines
  html = html.replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/<\/p>/gi, "\n");
  html = html.replace(/<p>/gi, "");

  // Remove all remaining HTML tags
  html = html.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  html = cleanText(html);

  // Clean up multiple newlines
  html = html.replace(/\n{3,}/g, "\n\n");

  return html.trim();
};

const extractTweetIdFromUrl = (url: string): string => {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : "";
};

const parseNumber = (value: string | number): number => {
  if (typeof value === "number") return value;
  if (!value) return 0;

  // Handle values like "5.5K" -> 5500, "1.2M" -> 1200000, "11K" -> 11000
  const numStr = String(value).trim().toUpperCase();
  if (numStr.includes("K")) {
    const num = parseFloat(numStr.replace("K", ""));
    return Math.round(num * 1000);
  }
  if (numStr.includes("M")) {
    const num = parseFloat(numStr.replace("M", ""));
    return Math.round(num * 1000000);
  }

  return parseInt(numStr, 10) || 0;
};

const cleanRedditEntry = (entry: any): ParsedItem | null => {
  if (!entry) return null;

  return {
    id: entry.id || "",
    title: cleanText(entry.title || ""),
    content: cleanHtmlContent(entry.content?.["#text"] || entry.content || ""),
    link: entry.link?.["@_href"] || entry.link || "",
    published: entry.published || entry.updated || "",
    updated: entry.updated || "",
  };
};

const cleanXItem = (item: any): ParsedItem | null => {
  if (!item) return null;

  // Extract values handling both direct values and nested #text
  const getValue = (field: any) => {
    if (typeof field === "string" || typeof field === "number") return field;
    return field?.["#text"] || field || "";
  };

  return {
    id: item.tweetId || extractTweetIdFromUrl(item.link || item.guid || ""),
    title: cleanText(item.title || ""),
    content: cleanText(item.description?.["#text"] || item.description || ""),
    link: item.link || item.guid || "",
    published: item.pubDate || "",
    replies: parseNumber(getValue(item.replies)),
    reposts: parseNumber(getValue(item.reposts)),
    likes: parseNumber(getValue(item.likes)),
    views: parseNumber(getValue(item.views)),
  };
};

const cleanGoogleItem = (item: any): ParsedItem | null => {
  if (!item) return null;

  return {
    id: item.guid?.["#text"] || item.guid || "",
    title: cleanText(item.title || ""),
    content: cleanHtmlContent(
      item.description?.["#text"] || item.description || ""
    ),
    link: item.link || "",
    source: item.source?.["#text"] || item.source || "",
    sourceUrl: item.source?.["@_url"] || "",
    published: item.pubDate || "",
  };
};

/**
 * Parse and clean RSS XML file
 */
const parseRSSFile = (filePath: string, platform: string, keyword: string): MergedRSSData | null => {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${filePath}`);
      return null;
    }

    const xmlContent = fs.readFileSync(filePath, "utf-8");
    
    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      parseAttributeValue: true,
      trimValues: true,
    });

    const parsedData = parser.parse(xmlContent);

    // Extract items based on format
    let items: ParsedItem[] = [];

    if (platform === "reddit") {
      // Atom feed format
      const entries = parsedData.feed?.entry || [];
      const entryArray = Array.isArray(entries) ? entries : entries ? [entries] : [];
      items = entryArray
        .map((entry: any) => cleanRedditEntry(entry))
        .filter((item: ParsedItem | null): item is ParsedItem => item !== null);
    } else if (platform === "X" || platform === "google") {
      // RSS 2.0 format
      const rssItems = parsedData.rss?.channel?.item || [];
      const itemArray = Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : [];
      items = itemArray
        .map((item: any) =>
          platform === "X" ? cleanXItem(item) : cleanGoogleItem(item)
        )
        .filter((item: ParsedItem | null): item is ParsedItem => item !== null);
    }

    return {
      platform,
      keyword,
      items,
    };
  } catch (error) {
    console.error(`❌ Error parsing ${filePath}:`, error);
    return null;
  }
};

/**
 * Generate RSS feeds for all keywords and merge into one TOON file
 */
export const generateAndMergeRSSFeeds = async (
  rssConfig: RSSConfig
): Promise<{
  mergedFilePath: string;
  totalItems: number;
  feedsGenerated: number;
  summary: { platform: string; keyword: string; itemsCount: number; filePath: string }[];
}> => {
  const { searchKeywords, queryCombinations = [] } = rssConfig;
  const platforms: ("x" | "reddit" | "google")[] = ["x", "reddit", "google"];
  const generatedFeeds: { platform: string; keyword: string; filePath: string }[] = [];
  const allMergedData: MergedRSSData[] = [];

  console.log(`🚀 Starting RSS generation for ${searchKeywords.length} keywords...`);

  // Generate RSS feeds for each keyword on each platform
  for (const keyword of searchKeywords) {
    for (const platform of platforms) {
      let generator: RSSGenerator | null = null;
      try {
        console.log(`📡 Generating ${platform} RSS feed for: "${keyword}"`);
        
        generator = new RSSGenerator(platform, keyword);
        await generator.init();
        
        // Get the file path that was generated
        const resultDir = path.join(
          process.cwd(),
          "result",
          platform === "x" ? "X" : platform
        );
        const xmlFiles = fs
          .readdirSync(resultDir)
          .filter((file) => file.startsWith(`rss_${keyword}_`) && file.endsWith(".xml"))
          .sort()
          .reverse(); // Get the most recent file
        
        if (xmlFiles.length > 0) {
          const filePath = path.join(resultDir, xmlFiles[0]);
          generatedFeeds.push({
            platform: platform === "x" ? "X" : platform,
            keyword,
            filePath,
          });
          console.log(`✅ Generated: ${filePath}`);
        }
      } catch (error) {
        console.error(`❌ Error generating ${platform} feed for "${keyword}":`, error);
      } finally {
        // Clean up browser if it was opened (for X feeds)
        if (generator) {
          try {
            await generator.close();
          } catch (closeError) {
            // Ignore close errors
          }
        }
      }
    }
  }

  // Optionally generate feeds for query combinations (mainly for Google)
  for (const query of queryCombinations.slice(0, 3)) { // Limit to 3 combinations
    let generator: RSSGenerator | null = null;
    try {
      console.log(`📡 Generating Google RSS feed for query: "${query}"`);
      
      generator = new RSSGenerator("google", query);
      await generator.init();
      
      const resultDir = path.join(process.cwd(), "result", "google");
      const xmlFiles = fs
        .readdirSync(resultDir)
        .filter((file) => file.startsWith(`rss_${query}_`) && file.endsWith(".xml"))
        .sort()
        .reverse();
      
      if (xmlFiles.length > 0) {
        const filePath = path.join(resultDir, xmlFiles[0]);
        generatedFeeds.push({
          platform: "google",
          keyword: query,
          filePath,
        });
        console.log(`✅ Generated: ${filePath}`);
      }
    } catch (error) {
      console.error(`❌ Error generating Google feed for "${query}":`, error);
    } finally {
      // Clean up (though Google doesn't use browser, this is safe)
      if (generator) {
        try {
          await generator.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }
    }
  }

  console.log(`\n📊 Parsing and merging ${generatedFeeds.length} RSS feeds...`);

  // Parse and merge all generated feeds
  for (const feed of generatedFeeds) {
    const parsedData = parseRSSFile(
      feed.filePath,
      feed.platform,
      feed.keyword
    );
    
    if (parsedData && parsedData.items.length > 0) {
      allMergedData.push(parsedData);
      console.log(
        `  ✓ ${feed.platform}/${feed.keyword}: ${parsedData.items.length} items`
      );
    }
  }

  // Calculate total items
  const totalItems = allMergedData.reduce(
    (sum, data) => sum + data.items.length,
    0
  );

  // Create summary
  const summary = allMergedData.map((data) => ({
    platform: data.platform,
    keyword: data.keyword,
    itemsCount: data.items.length,
    filePath: generatedFeeds.find(
      (f) => f.platform === data.platform && f.keyword === data.keyword
    )?.filePath || "",
  }));

  // Save merged data to TOON format
  const outputDir = path.join(process.cwd(), "result");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const mergedFilePath = path.join(
    outputDir,
    `merged_rss_${timestamp}.toon`
  );

  const toonData = encode(allMergedData);
  fs.writeFileSync(mergedFilePath, toonData, "utf-8");

  console.log(`\n✅ Merged RSS data saved to: ${mergedFilePath}`);
  console.log(`📊 Total items: ${totalItems}`);
  console.log(`📁 Total feeds: ${generatedFeeds.length}`);

  return {
    mergedFilePath,
    totalItems,
    feedsGenerated: generatedFeeds.length,
    summary,
  };
};

