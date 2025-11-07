import express from "express";
import dotenv from "dotenv";

dotenv.config()

const app = express();

app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true }));

// routes

export default app;