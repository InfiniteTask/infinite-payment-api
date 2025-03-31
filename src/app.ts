import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import paymentRoutes from "./routes/paymentRoutes";

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Routes
app.use("/api/payments", paymentRoutes);

export default app;
