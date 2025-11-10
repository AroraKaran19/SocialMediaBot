import app from "./app";
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "./config/database";

dotenv.config();

if (!process.env.PORT) {
  throw new Error("PORT is not defined in environment variables");
}

const PORT = process.env.PORT;

// Connect to database and start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start the server
    const server = app.listen(PORT, () => {
      console.log(
        `🚀 Social Media Bot Backend Server is running on port ${PORT}`
      );
      console.log(
        `🌐 Health check available at: http://localhost:${PORT}/health`
      );
    });

    // Gracefully shutdown the server
    process.on("SIGTERM", () => {
      console.log("🔄 Shutting down server...");
      server.close(() => {
        console.log("🔒 Server closed");
        disconnectDB();
      });
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
