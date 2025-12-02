import { Router } from "express";
import { generateDescription } from "../services/content.services";
import { generateAndMergeRSSFeeds } from "../services/rssGeneration.service";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Endpoint for product analysis only
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { productDescription } = req.body;
    const file = req.file;

    if (!productDescription) {
      return res.status(400).json({
        error: "productDescription is required",
      });
    }

    const productAnalysis = await generateDescription(
      productDescription,
      file?.mimetype || "",
      file?.buffer.toString("base64") || ""
    );

    return res.json(productAnalysis);
  } catch (error) {
    console.error("❌ Error in content analysis:", error);
    return res.status(500).json({
      error: "Failed to generate product analysis",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Endpoint for product analysis + RSS generation
router.post("/with-rss", upload.single("image"), async (req, res) => {
  try {
    const { productDescription } = req.body;
    const file = req.file;

    if (!productDescription) {
      return res.status(400).json({
        error: "productDescription is required",
      });
    }

    // Step 1: Generate product analysis
    console.log("📊 Step 1: Generating product analysis...");
    const productAnalysis = await generateDescription(
      productDescription,
      file?.mimetype || "",
      file?.buffer.toString("base64") || ""
    );

    // Step 2: Generate and merge RSS feeds
    console.log("📡 Step 2: Generating RSS feeds...");
    const rssResult = await generateAndMergeRSSFeeds(productAnalysis.rssConfig);

    // Combine results
    const response = {
      productAnalysis: productAnalysis.productAnalysis,
      rssConfig: productAnalysis.rssConfig,
      originalInput: productAnalysis.originalInput,
      hasImage: productAnalysis.hasImage,
      rssFeeds: {
        mergedFilePath: rssResult.mergedFilePath,
        totalItems: rssResult.totalItems,
        feedsGenerated: rssResult.feedsGenerated,
        summary: rssResult.summary,
      },
    };

    return res.json(response);
  } catch (error) {
    console.error("❌ Error in content analysis with RSS:", error);
    return res.status(500).json({
      error: "Failed to generate product analysis and RSS feeds",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
