import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Customer } from "../models/customer";
import { Product } from "../models/product";
import { Task } from "../models/task";
import { User } from "../models/user";
import { customerService } from "../services/customer.service";
import { taskService } from "../services/task.service";

const adminEmail = process.env.ADMIN_EMAIL || "admin@demo.com";
const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!";
const adminName = process.env.ADMIN_NAME || "Demo Admin";
const storeId = process.env.PUBLIC_STORE_ID || process.env.DEMO_STORE_ID || "demo-store-001";

const products = [
  {
    name: "AeroFit Smart Watch",
    description: "Water-resistant fitness watch with heart-rate tracking and sleep insights.",
    price: 129,
    stock_quantity: 42,
    category: "Wearables",
    image_url: "https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=1200&q=80",
  },
  {
    name: "Northstar Wireless Headphones",
    description: "Noise-canceling over-ear headphones with 40-hour battery life.",
    price: 179,
    stock_quantity: 28,
    category: "Audio",
    image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1200&q=80",
  },
  {
    name: "Orbit Bluetooth Speaker",
    description: "Portable waterproof speaker with rich bass for indoor and outdoor use.",
    price: 69,
    stock_quantity: 55,
    category: "Audio",
    image_url: "https://images.unsplash.com/photo-1589003077984-894e133dabab?w=1200&q=80",
  },
  {
    name: "Nova Mechanical Keyboard",
    description: "Compact RGB mechanical keyboard with tactile switches.",
    price: 94,
    stock_quantity: 31,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?w=1200&q=80",
  },
  {
    name: "SwiftCharge USB-C Hub",
    description: "Eight-port USB-C hub with HDMI, card reader, and fast charging.",
    price: 59,
    stock_quantity: 63,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1625842268584-8f3296236761?w=1200&q=80",
  },
  {
    name: "Vista 27 Inch 4K Monitor",
    description: "Color-accurate 4K monitor for office, design, and entertainment.",
    price: 329,
    stock_quantity: 17,
    category: "Displays",
    image_url: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=1200&q=80",
  },
  {
    name: "Pulse Gaming Mouse",
    description: "Lightweight wireless mouse with adjustable DPI and quiet clicks.",
    price: 49,
    stock_quantity: 74,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=1200&q=80",
  },
  {
    name: "HomeGlow Smart Bulb Pack",
    description: "Four Wi-Fi LED bulbs with dimming, schedules, and color scenes.",
    price: 39,
    stock_quantity: 86,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1565814636199-ae8133055c1c?w=1200&q=80",
  },
  {
    name: "AirPure Desk Purifier",
    description: "Compact HEPA air purifier for bedrooms, offices, and small studios.",
    price: 119,
    stock_quantity: 22,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=1200&q=80",
  },
  {
    name: "Vault Portable SSD 1TB",
    description: "Fast external SSD with rugged casing and USB-C transfer speeds.",
    price: 139,
    stock_quantity: 35,
    category: "Storage",
    image_url: "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=1200&q=80",
  },
];

const customers = [
  { name: "Maya Chen", email: "maya.chen@example.com", phone: "+1-202-555-0141", address: "112 Oak Street, Seattle, WA" },
  { name: "Daniel Brooks", email: "daniel.brooks@example.com", phone: "+1-202-555-0142", address: "48 Market Avenue, Austin, TX" },
  { name: "Ayesha Khan", email: "ayesha.khan@example.com", phone: "+1-202-555-0143", address: "77 Lakeview Drive, Chicago, IL" },
  { name: "Luis Martinez", email: "luis.martinez@example.com", phone: "+1-202-555-0144", address: "9 Palm Court, Miami, FL" },
  { name: "Priya Sharma", email: "priya.sharma@example.com", phone: "+1-202-555-0145", address: "305 Pine Road, Denver, CO" },
];

const tasks = [
  {
    title: "Follow up with Maya about headphone warranty",
    description: "Confirm replacement eligibility and share shipping timeline.",
    priority: "high",
    status: "todo",
  },
  {
    title: "Reorder low-stock 4K monitors",
    description: "Check supplier pricing and place restock order before Friday.",
    priority: "urgent",
    status: "in_progress",
  },
  {
    title: "Prepare weekly store performance summary",
    description: "Review products, customers, tasks, and sales notes for the admin dashboard.",
    priority: "medium",
    status: "todo",
  },
] as const;

const ensureAdmin = async () => {
  const existing = await User.findOne({ email: adminEmail });
  if (existing) return existing;

  return User.create({
    name: adminName,
    email: adminEmail,
    password: adminPassword,
    role: "admin",
    storeId,
  });
};

const seed = async () => {
  await connectDB();
  const admin = await ensureAdmin();
  const adminId = admin._id.toString();
  const activeStoreId = admin.storeId || storeId;

  const [productCount, customerCount, taskCount] = await Promise.all([
    Product.countDocuments({ store_id: activeStoreId }),
    Customer.countDocuments({ createdBy: admin._id }),
    Task.countDocuments({ createdBy: admin._id }),
  ]);

  if (productCount || customerCount || taskCount) {
    console.log("Seed skipped: demo records already exist.");
    console.log(`Admin email: ${admin.email}`);
    console.log(`Store ID: ${activeStoreId}`);
    return;
  }

  await Product.insertMany(
    products.map((product) => ({
      ...product,
      store_id: activeStoreId,
      createdBy: admin._id,
      is_recommended: product.stock_quantity > 30,
      popularity_score: 50,
      top_selling: product.price >= 100,
      total_sold: 0,
    }))
  );

  for (const customer of customers) {
    await customerService.createCustomer(adminId, customer);
  }

  for (const task of tasks) {
    await taskService.createTask(adminId, {
      ...task,
      assignedTo: adminId,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  console.log("Demo data seeded.");
  console.log(`Admin email: ${admin.email}`);
  console.log(`Admin password: ${adminPassword}`);
  console.log(`Store ID: ${activeStoreId}`);
  console.log("Created: 10 products, 5 customers, 3 tasks.");
};

seed()
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
