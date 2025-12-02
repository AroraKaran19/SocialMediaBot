import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import { encode } from "@toon-format/toon";

interface ParsedItem {
  [key: string]: any;
}

interface CleanedData {
  platform: string;
  keyword: string;
  items: ParsedItem[];
}

const cleanData = async (): Promise<CleanedData[]> => {
  const resultDir = path.join(process.cwd(), "result");
  const allCleanedData: CleanedData[] = [];

  // Iterate through platform directories (X, reddit, google)
  const platforms = fs
    .readdirSync(resultDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const platform of platforms) {
    const platformDir = path.join(resultDir, platform);
    const xmlFiles = fs
      .readdirSync(platformDir)
      .filter((file) => file.endsWith(".xml"));

    for (const xmlFile of xmlFiles) {
      const filePath = path.join(platformDir, xmlFile);
      const xmlContent = fs.readFileSync(filePath, "utf-8");

      // Extract keyword from filename (format: rss_{keyword}_{timestamp}.xml)
      const keywordMatch = xmlFile.match(/rss_(.+?)_\d+\.xml/);
      const keyword = keywordMatch ? keywordMatch[1] : "unknown";

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
        items = Array.isArray(entries) ? entries : [entries];
        items = items.map((entry: any) => cleanRedditEntry(entry));
      } else if (platform === "X" || platform === "google") {
        // RSS 2.0 format
        const rssItems = parsedData.rss?.channel?.item || [];
        items = Array.isArray(rssItems) ? rssItems : [rssItems];
        items = items.map((item: any) =>
          platform === "X" ? cleanXItem(item) : cleanGoogleItem(item)
        );
      }

      allCleanedData.push({
        platform,
        keyword,
        items: items.filter((item) => item !== null),
      });
    }
  }

  return allCleanedData;
};

const cleanRedditEntry = (entry: any): ParsedItem => {
  if (!entry) return null as any;

  return {
    id: entry.id || "",
    title: cleanText(entry.title || ""),
    content: cleanHtmlContent(entry.content?.["#text"] || entry.content || ""),
    link: entry.link?.["@_href"] || entry.link || "",
    published: entry.published || entry.updated || "",
    updated: entry.updated || "",
  };
};

const cleanXItem = (item: any): ParsedItem => {
  if (!item) return null as any;

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

const cleanGoogleItem = (item: any): ParsedItem => {
  if (!item) return null as any;

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

(async () => {
  try {
    const cleanedData = await cleanData();

    // Output summary
    console.log(`✅ Processed ${cleanedData.length} files`);
    cleanedData.forEach((data) => {
      console.log(
        `  - ${data.platform}: ${data.items.length} items (keyword: ${data.keyword})`
      );
    });

    // Save cleaned data to TOON format
    const outputPath = path.join(process.cwd(), "result", "cleaned_data.toon");
    const toonData = encode(cleanedData);
    fs.writeFileSync(outputPath, toonData, "utf-8");
    console.log(`\n📄 Cleaned data saved to: ${outputPath}`);
  } catch (error) {
    console.error("❌ Error cleaning data:", error);
  }
})();
