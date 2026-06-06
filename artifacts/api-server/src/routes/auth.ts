import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { syncUserToSupabase } from "../lib/supabase";

const router = Router();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const incoming = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(incoming, expected);
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, password, name, phone } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    phone?: string;
  };

  if (!email || !password || !name) {
    res.status(400).json({ error: "Email, password, and name are required." });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  try {
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const passwordHash = hashPassword(password);
    const [user] = await db.insert(usersTable).values({
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
      phone: phone?.trim() ?? null,
    }).returning();

    (req.session as any).userId = user.id;
    (req.session as any).userEmail = user.email;
    (req.session as any).userName = user.name;

    req.session.save((err) => {
      if (err) { res.status(500).json({ error: "Session error" }); return; }
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, phone: user.phone } });
    });

    // Sync to Supabase (non-blocking — fire and forget)
    syncUserToSupabase({ email: email.toLowerCase().trim(), password, name: name.trim(), phone: phone?.trim() });
  } catch (err: any) {
    req.log.error(err, "Registration error");
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    (req.session as any).userId = user.id;
    (req.session as any).userEmail = user.email;
    (req.session as any).userName = user.name;

    req.session.save((err) => {
      if (err) { res.status(500).json({ error: "Session error" }); return; }
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, phone: user.phone } });
    });
  } catch (err: any) {
    req.log.error(err, "Login error");
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("didee.sid");
    res.json({ success: true });
  });
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) {
    res.status(401).json({ authenticated: false });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, user: { id: user.id, email: user.email, name: user.name, phone: user.phone } });
  } catch {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// PATCH /api/auth/profile
router.patch("/profile", async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { name, phone } = req.body as { name?: string; phone?: string };
  try {
    const [user] = await db.update(usersTable)
      .set({ name: name?.trim() ?? undefined, phone: phone?.trim() ?? undefined, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();
    if (user) (req.session as any).userName = user.name;
    res.json({ user: { id: user.id, email: user.email, name: user.name, phone: user.phone } });
  } catch {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /api/auth/orders  — get orders for the logged-in user
router.get("/orders", async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const { db, ordersTable, orderItemsTable } = await import("@workspace/db");
    const { eq, desc } = await import("drizzle-orm");
    const userOrders = await db.select().from(ordersTable)
      .where(eq(ordersTable.userId, userId))
      .orderBy(desc(ordersTable.createdAt));

    const enriched = await Promise.all(userOrders.map(async (order) => {
      const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
      return {
        ...order,
        subtotal: parseFloat(order.subtotal),
        shippingCost: parseFloat(order.shippingCost),
        discount: parseFloat(order.discount),
        total: parseFloat(order.total),
        createdAt: order.createdAt.toISOString(),
        items: items.map(i => ({ ...i, price: parseFloat(i.price) })),
      };
    }));

    res.json(enriched);
  } catch (err: any) {
    req.log.error(err, "Failed to fetch user orders");
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

export default router;
