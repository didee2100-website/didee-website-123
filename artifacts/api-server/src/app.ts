import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPg from "connect-pg-simple";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PgStore = connectPg(session);

const sessionStore = process.env.DATABASE_URL
  ? new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      tableName: "session",
    })
  : undefined;

app.use(
  session({
    store: sessionStore,
    secret: process.env["SESSION_SECRET"] ?? "didee-secret-fallback",
    name: "didee.admin.sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);

app.use("/api/uploads", express.static(path.join(__dirname, "..", "..", "uploads")));

app.use("/api", router);

export default app;
