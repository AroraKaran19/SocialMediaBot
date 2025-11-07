import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const mongoUri = process.env.MONGODB_URI!;
const proxies = process.env.PROXIES!;

const cleanProxyUrl = (url: string): string => {
  return url
    .replace(/["'\[\]{}()]/g, "") // Remove quotes, brackets, braces, parentheses
    .trim(); // Remove whitespace
};

const connect = async () => {
  await mongoose.connect(mongoUri);
  console.log("✅ Connected to MongoDB");

  const db = mongoose.connection.db;
  const collection = db?.collection("proxy");

  const proxyData: {
    proxyUrl: string;
    proxyUsername: string;
    proxyPassword: string;
  }[] = proxies.split(",").map((proxy) => {
    const parts = proxy.split(":");
    const ip = cleanProxyUrl(parts[0]);
    const port = parts[1] || "";
    const username = parts[2] || "";
    const password = parts[3] || "";
    return {
      proxyUrl: `${ip}:${port}`, // Store IP:PORT format
      proxyUsername: username,
      proxyPassword: password,
    };
  });

  for (const proxy of proxyData) {
    // check if it exists
    const result = await collection?.findOne({ proxyUrl: proxy.proxyUrl });
    if (!result) {
      await collection?.insertOne({
        proxyUrl: proxy.proxyUrl,
        proxyUsername: proxy.proxyUsername,
        proxyPassword: proxy.proxyPassword,
        usage: 0,
        lastUsed: null
      });
    }
  }

  await mongoose.connection.close();
  console.log("🔒 Connection closed");
};

connect();
