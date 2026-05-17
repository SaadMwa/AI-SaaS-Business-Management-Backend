import routes from "./routes";
import express from "express";
import cors from "cors";
import { notFound } from "./middlewares/not-found";
import { errorHandler } from "./middlewares/error-handler";
import aiRoute from "./routes/ai.route";
import { sanitizeInput } from "./middlewares/sanitize.middleware";
import { corsOptions } from "./config/cors";

const app = express();

app.use(express.json());
app.use(sanitizeInput);
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use("/api", routes);
app.use("/api/ai", aiRoute);
// Support deployments that expose the API at the root path.
app.use("/", routes);
app.use("/ai", aiRoute);

app.get("/", (_req, res) => {
  res.json({ success: true, message: "Backend API is running" });
});

app.use(notFound);
app.use(errorHandler);

export default app;
