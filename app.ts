import express from "express";

const app = express();

// Middlewares
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Social Media Bot Backend Server is running",
    timestamp: new Date().toISOString(),
  });
});

// API Routes

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "WishBee Backend API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "/health",
      api: "/api",
    },
  });
});

export default app;
