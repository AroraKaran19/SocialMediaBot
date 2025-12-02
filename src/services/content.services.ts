import axios from "axios";

export const generateDescription = async (
  productDescription: string,
  fileType: string,
  base64Data: string
) => {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-5-nano",
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: `You are an expert product content strategist and marketing analyst. Your task is to analyze product information and generate specific outputs for content marketing and RSS feed generation.

Generate the following outputs:

1. **Description**: Create a compelling, engaging product description that highlights key features, benefits, and unique selling points. Make it persuasive and optimized for social media platforms.

2. **Keywords**: Generate relevant keywords and hashtags that are important for this product. Include a mix of product-specific terms, category keywords, and trending/relevant tags. Return as an array of strings. Include both regular keywords and hashtags (with #).

3. **Target Audience**: Identify and describe the target audience for this product. Include demographics, psychographics, interests, and pain points that this product addresses.

4. **Search Keywords**: Select the top 5 most important keywords from your keywords list that would be best for searching RSS feeds (X/Twitter, Reddit, Google News). These should be the most relevant and searchable terms. Return as an array of exactly 5 strings.

When an image is provided, incorporate visual details and context from the image into your analysis.

CRITICAL: You must respond with ONLY valid JSON. The response must contain exactly these four keys at the root level:
- "description" (string value)
- "keywords" (array of strings - can include hashtags)
- "targetAudience" (string value)
- "searchKeywords" (array of exactly 5 strings - top keywords for RSS search)

Example of CORRECT format:
{
  "description": "the product description text here",
  "keywords": ["keyword1", "keyword2", "#hashtag1", "keyword3"],
  "targetAudience": "the target audience description here",
  "searchKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
}`,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Product Description: ${productDescription}`,
            },
            ...(base64Data
              ? [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${fileType};base64,${base64Data}`,
                    },
                  },
                ]
              : []),
          ],
        },
      ],
      modalities: ["text"],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  const content = response.data.choices[0].message.content;
  const usage = response.data.usage || {};

  // Parse JSON response, handling potential markdown code blocks
  let jsonString = content.trim();
  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (jsonString.startsWith("```")) {
    jsonString = jsonString.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsedContent = JSON.parse(jsonString);

    // Extract search keywords (top 5, or use first 5 from keywords if not provided)
    const allKeywords = parsedContent.keywords || [];
    const searchKeywords = parsedContent.searchKeywords || allKeywords.slice(0, 5);
    
    // Generate query combinations for RSS search
    const queryCombinations: string[] = [];
    // Single keyword queries
    searchKeywords.slice(0, 3).forEach((keyword: string) => {
      queryCombinations.push(keyword.replace(/^#/, "")); // Remove # for search
    });
    // Two-keyword combinations (top 2 combined)
    if (searchKeywords.length >= 2) {
      queryCombinations.push(
        `${searchKeywords[0].replace(/^#/, "")} ${searchKeywords[1].replace(/^#/, "")}`
      );
    }

    // Build the enhanced response structure
    return {
      productAnalysis: {
        description: parsedContent.description || "",
        keywords: allKeywords,
        targetAudience: parsedContent.targetAudience || "",
        tokens: {
          input: usage.prompt_tokens || 0,
          output: usage.completion_tokens || 0,
          total:
            usage.total_tokens ||
            (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
        },
      },
      rssConfig: {
        searchKeywords: searchKeywords.map((k: string) => k.replace(/^#/, "")), // Remove # for search
        queryCombinations: queryCombinations,
      },
      originalInput: productDescription,
      hasImage: !!base64Data,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse JSON response: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
