import { Router } from "express";

const router = Router();

const ADMIN_EMAIL = process.env["ADMIN_EMAIL"] ?? "";
const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "";

// POST /api/admin/login
router.post("/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase() || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  (req.session as any).adminAuthenticated = true;
  (req.session as any).adminEmail = email;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session error" });
      return;
    }
    res.json({ success: true, email });
  });
});

// POST /api/admin/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("didee.admin.sid");
    res.json({ success: true });
  });
});

// GET /api/admin/me
router.get("/me", (req, res) => {
  if ((req.session as any).adminAuthenticated) {
    res.json({ authenticated: true, email: (req.session as any).adminEmail });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

export default router;
