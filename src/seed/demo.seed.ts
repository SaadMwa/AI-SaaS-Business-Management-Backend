import mongoose from "mongoose";
import { User } from "../models/user";
import { Product } from "../models/product";
import { HistoryLog } from "../models/historyLog";
import { customerService } from "../services/customer.service";
import { taskService } from "../services/task.service";
import { saleService } from "../services/sale.service";
import { logger } from "../utils/logger";

type ProductSeed = {
  name: string;
  description: string;
  price: number;
  category: "Electronics" | "Accessories" | "Wearables" | "Home" | "Gaming";
  image_url: string;
};

type CustomerSeed = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

const DEMO_ADMIN_EMAIL = "admin@demo.com";
const DEMO_ADMIN_PASSWORD = "Admin123!";
const DEMO_ADMIN_NAME = "Demo Store";
const DEMO_STORE_ID = process.env.DEMO_STORE_ID || "demo-store-001";

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    name: "Sony WH-1000XM5 Headphones",
    description: "Premium wireless noise-canceling headphones with long battery life.",
    price: 299,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1200&q=80",
  },
  {
    name: "JBL Tune 760NC",
    description: "Foldable over-ear headphones with adaptive noise cancellation.",
    price: 129,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1578319439584-104c94d37305?w=1200&q=80",
  },
  {
    name: "Apple Watch Series 9",
    description: "Advanced smartwatch with health tracking and seamless app integration.",
    price: 399,
    category: "Wearables",
    image_url: "https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=1200&q=80",
  },
  {
    name: "Samsung Galaxy Buds 2 Pro",
    description: "True wireless earbuds with rich sound and active noise cancellation.",
    price: 189,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=1200&q=80",
  },
  {
    name: "Logitech MX Master 3S Mouse",
    description: "Ergonomic productivity mouse with precision tracking and quiet clicks.",
    price: 109,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=1200&q=80",
  },
  {
    name: "Mechanical Keyboard RGB",
    description: "Tactile mechanical keyboard with RGB backlighting and aluminum frame.",
    price: 99,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?w=1200&q=80",
  },
  {
    name: "4K Monitor 27\"",
    description: "Ultra HD 27-inch display with HDR support and accurate color reproduction.",
    price: 329,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=1200&q=80",
  },
  {
    name: "Wireless Charger Stand",
    description: "Fast wireless charging stand for phones and earbuds.",
    price: 39,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1587033411391-5d9e51cce126?w=1200&q=80",
  },
  {
    name: "PS5 Controller",
    description: "DualSense controller with immersive haptic feedback and adaptive triggers.",
    price: 74,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=1200&q=80",
  },
  {
    name: "Gaming Headset Pro",
    description: "Surround-sound gaming headset with detachable microphone.",
    price: 119,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1599669454699-248893623440?w=1200&q=80",
  },
  {
    name: "RGB Gaming Mousepad XL",
    description: "Extended desk mousepad with customizable RGB edge lighting.",
    price: 35,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1605774337664-7a846e9cdf17?w=1200&q=80",
  },
  {
    name: "Smart LED Bulb",
    description: "Wi-Fi smart bulb with app control and multiple color scenes.",
    price: 19,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1565814636199-ae8133055c1c?w=1200&q=80",
  },
  {
    name: "Air Purifier",
    description: "HEPA air purifier for cleaner indoor air and quieter operation.",
    price: 149,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=1200&q=80",
  },
  {
    name: "Smart Plug WiFi",
    description: "Schedule and control appliances remotely via mobile app.",
    price: 24,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1558002038-1055907df827?w=1200&q=80",
  },
  {
    name: "USB-C Hub 8-in-1",
    description: "Portable multi-port hub with HDMI, USB-A, USB-C, and card readers.",
    price: 59,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1625842268584-8f3296236761?w=1200&q=80",
  },
  {
    name: "Portable Bluetooth Speaker",
    description: "Compact waterproof speaker with clear bass and long battery life.",
    price: 69,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1589003077984-894e133dabab?w=1200&q=80",
  },
  {
    name: "Noise Isolating Earbuds",
    description: "Comfort-fit earbuds with passive noise isolation and deep bass.",
    price: 49,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1484704849700-f032a568e944?w=1200&q=80",
  },
  {
    name: "Webcam Full HD",
    description: "1080p webcam with autofocus and dual microphones for meetings.",
    price: 79,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=1200&q=80",
  },
  {
    name: "Laptop Cooling Pad",
    description: "Adjustable cooling stand with silent dual-fan airflow.",
    price: 42,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=1200&q=80",
  },
  {
    name: "Smart Fitness Band",
    description: "Slim fitness tracker with heart-rate and sleep monitoring.",
    price: 59,
    category: "Wearables",
    image_url: "https://images.unsplash.com/photo-1557935728-e6d1eaabe558?w=1200&q=80",
  },
  {
    name: "Wireless Presentation Clicker",
    description: "Rechargeable presenter remote with laser pointer.",
    price: 29,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=1200&q=80",
  },
  {
    name: "Smart Door Sensor",
    description: "Home entry sensor with instant mobile alerts.",
    price: 31,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1558002038-1055907df827?w=1200&q=80",
  },
  {
    name: "Robot Vacuum Lite",
    description: "Automatic vacuum cleaner with scheduled cleaning modes.",
    price: 219,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1518640467707-6811f4a6ab73?w=1200&q=80",
  },
  {
    name: "Gaming Monitor 165Hz",
    description: "Fast-refresh gaming monitor with low response time.",
    price: 279,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1593640408182-31c228c6e4b0?w=1200&q=80",
  },
  {
    name: "Streaming Microphone USB",
    description: "Cardioid condenser microphone for streaming and podcasting.",
    price: 89,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=1200&q=80",
  },
  {
    name: "VR Headset Stand",
    description: "Minimal stand for VR headset and controller organization.",
    price: 34,
    category: "Gaming",
    image_url: "https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?w=1200&q=80",
  },
  {
    name: "Smart Thermostat Hub",
    description: "Remote temperature control with scheduling and energy insights.",
    price: 169,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=1200&q=80",
  },
  {
    name: "Indoor Security Camera",
    description: "1080p home camera with motion detection and night vision.",
    price: 89,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1557324232-b8917d3c3dcb?w=1200&q=80",
  },
  {
    name: "Smart Scale Body Analyzer",
    description: "Body composition scale with app sync and progress tracking.",
    price: 65,
    category: "Wearables",
    image_url: "https://images.unsplash.com/photo-1576678927484-cc907957088c?w=1200&q=80",
  },
  {
    name: "Wireless Earhook Sport Buds",
    description: "Sweat-resistant earbuds designed for running and workouts.",
    price: 79,
    category: "Wearables",
    image_url: "https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=1200&q=80",
  },
  {
    name: "USB-C Fast Charger 65W",
    description: "Compact GaN wall charger for phones, tablets, and laptops.",
    price: 45,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=1200&q=80",
  },
  {
    name: "Smart Light Strip RGB",
    description: "Music-reactive RGB strip lights with app scenes.",
    price: 54,
    category: "Home",
    image_url: "https://images.unsplash.com/photo-1550684376-efcbd6e3f031?w=1200&q=80",
  },
  {
    name: "Tablet Stylus Pen",
    description: "Pressure-sensitive stylus pen for drawing and note-taking.",
    price: 39,
    category: "Accessories",
    image_url: "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?w=1200&q=80",
  },
  {
    name: "Action Camera 4K",
    description: "Water-resistant action camera with stabilization mode.",
    price: 139,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1516724562728-afc824a36e84?w=1200&q=80",
  },
  {
    name: "Portable SSD 1TB",
    description: "High-speed external solid-state drive with USB-C connectivity.",
    price: 129,
    category: "Electronics",
    image_url: "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=1200&q=80",
  },
];

const CUSTOMER_SEEDS: CustomerSeed[] = [
  { name: "Ali Khan", email: "ali.khan@example.com", phone: "+1-202-555-0101", address: "12 Elm Street, Austin, TX" },
  { name: "Ahmed Raza", email: "ahmed.raza@example.com", phone: "+1-202-555-0102", address: "48 Pine Avenue, Dallas, TX" },
  { name: "Sarah Malik", email: "sarah.malik@example.com", phone: "+1-202-555-0103", address: "77 Lake View, Seattle, WA" },
  { name: "Fatima Noor", email: "fatima.noor@example.com", phone: "+1-202-555-0104", address: "201 Sunset Blvd, Los Angeles, CA" },
  { name: "Usman Tariq", email: "usman.tariq@example.com", phone: "+1-202-555-0105", address: "9 Oak Hill Rd, Denver, CO" },
  { name: "Ayesha Siddiqui", email: "ayesha.siddiqui@example.com", phone: "+1-202-555-0106", address: "5 Harbor Street, Boston, MA" },
  { name: "Bilal Hassan", email: "bilal.hassan@example.com", phone: "+1-202-555-0107", address: "332 Broadway, New York, NY" },
  { name: "Hira Aslam", email: "hira.aslam@example.com", phone: "+1-202-555-0108", address: "66 Market St, San Francisco, CA" },
  { name: "Zain Ali", email: "zain.ali@example.com", phone: "+1-202-555-0109", address: "121 River Rd, Portland, OR" },
  { name: "Noor Fatima", email: "noor.fatima@example.com", phone: "+1-202-555-0110", address: "84 Garden Lane, Chicago, IL" },
  { name: "Hamza Iqbal", email: "hamza.iqbal@example.com", phone: "+1-202-555-0111", address: "199 Green Street, Miami, FL" },
  { name: "Mariam Sheikh", email: "mariam.sheikh@example.com", phone: "+1-202-555-0112", address: "41 Cedar Park, Phoenix, AZ" },
  { name: "Omar Farooq", email: "omar.farooq@example.com", phone: "+1-202-555-0113", address: "88 Grand Ave, San Diego, CA" },
  { name: "Sana Javed", email: "sana.javed@example.com", phone: "+1-202-555-0114", address: "700 Lake Shore, Chicago, IL" },
  { name: "Taha Qureshi", email: "taha.qureshi@example.com", phone: "+1-202-555-0115", address: "52 Willow Dr, Atlanta, GA" },
  { name: "Rida Imran", email: "rida.imran@example.com", phone: "+1-202-555-0116", address: "18 Bay Street, Tampa, FL" },
  { name: "Hassan Nadeem", email: "hassan.nadeem@example.com", phone: "+1-202-555-0117", address: "90 Maple St, Columbus, OH" },
  { name: "Iqra Saleem", email: "iqra.saleem@example.com", phone: "+1-202-555-0118", address: "303 Hill Road, Charlotte, NC" },
];

const TASK_SEEDS = [
  "Follow up with Ali Khan",
  "Check low stock headphones",
  "Confirm pending sale with Sarah Malik",
  "Contact supplier for keyboard shipment",
  "Review top-selling products report",
  "Update wearable category prices",
  "Call Ahmed Raza about warranty issue",
  "Prepare weekly sales summary",
  "Verify payment for recent order",
  "Resolve delayed shipping ticket",
  "Reconcile yesterday's cash transactions",
  "Schedule customer feedback calls",
  "Audit product descriptions for SEO",
  "Check stock for gaming accessories",
  "Prepare campaign for home products",
  "Investigate cart drop-offs",
  "Confirm replacement request",
  "Update featured products list",
  "Send thank-you email to top customers",
  "Review AI assistant query logs",
];

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomBool = () => Math.random() > 0.5;
const pickOne = <T,>(arr: T[]) => arr[randomInt(0, arr.length - 1)];

const pickSome = <T,>(arr: T[], count: number) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, count);
};

const randomDateWithinDays = (days: number) => {
  const now = Date.now();
  const offset = randomInt(0, days * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const createSeedHistory = async (params: {
  userId: string;
  entityType: "task" | "customer" | "sale" | "ai";
  entityNumber?: number;
  actionType: string;
  source: "user" | "system";
  meta?: Record<string, unknown>;
}) => {
  await HistoryLog.create({
    userId: new mongoose.Types.ObjectId(params.userId),
    entityType: params.entityType,
    entityId: params.entityNumber,
    entityNumber: params.entityNumber,
    actionType: params.actionType,
    action: params.actionType,
    performedBy: params.source,
    performedById: params.source === "user" ? new mongoose.Types.ObjectId(params.userId) : undefined,
    details: {
      source: params.source,
      ...(params.meta || {}),
    },
    meta: {
      source: params.source,
      ...(params.meta || {}),
    },
  });
};

export async function seedDemoData() {
  const enabled = process.env.ENABLE_DEMO_SEED === "true";
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !enabled) {
    logger.warn("demo_seed_skipped", { reason: "production_without_explicit_enable" });
    return;
  }

  if (!enabled) {
    logger.info("demo_seed_skipped", { reason: "ENABLE_DEMO_SEED_not_true" });
    return;
  }

  try {
    const existingAdmin = await User.findOne({ email: DEMO_ADMIN_EMAIL }).lean();
    if (existingAdmin) {
      logger.info("demo_seed_skipped", { reason: "admin_exists", email: DEMO_ADMIN_EMAIL });
      return;
    }

    const admin = await User.create({
      name: DEMO_ADMIN_NAME,
      email: DEMO_ADMIN_EMAIL,
      password: DEMO_ADMIN_PASSWORD,
      role: "admin",
      storeId: DEMO_STORE_ID,
    });

    const createdProducts: Array<{ _id: mongoose.Types.ObjectId; name: string; salePrice: number }> = [];
    for (const [index, product] of PRODUCT_SEEDS.entries()) {
      const stock = index < 4 ? randomInt(3, 8) : randomInt(10, 200);
      const created = await Product.create({
        name: product.name,
        description: product.description,
        price: product.price,
        stock_quantity: stock,
        image_url: product.image_url,
        category: product.category,
        is_recommended: randomBool(),
        top_selling: index < 6 ? true : randomBool(),
        popularity_score: randomInt(1, 100),
        total_sold: randomInt(0, 300),
        last_sold_at: randomDateWithinDays(45),
        store_id: DEMO_STORE_ID,
        createdBy: admin._id,
      });
      createdProducts.push({
        _id: created._id as mongoose.Types.ObjectId,
        name: created.name,
        salePrice: Number(created.price),
      });

      await createSeedHistory({
        userId: admin._id.toString(),
        entityType: "ai",
        actionType: "product_create",
        source: "system",
        meta: { productName: created.name, category: created.category, stock: created.stock_quantity },
      });
    }

    const customers = [];
    for (const customer of CUSTOMER_SEEDS) {
      const created = await customerService.createCustomer(admin._id.toString(), {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        _performedBy: "user",
      });
      customers.push(created);
    }

    const tasks = [];
    for (let i = 0; i < TASK_SEEDS.length; i += 1) {
      const title = TASK_SEEDS[i];
      const priority = i < 6 ? "high" : pickOne(["low", "medium", "high"]);
      const status = i % 5 === 0 ? "done" : pickOne(["todo", "in_progress", "blocked"]);
      const relatedCustomer = pickOne(customers);
      const dueDate =
        status === "done"
          ? addDays(new Date(), -randomInt(1, 20))
          : i < 4
            ? addDays(new Date(), -randomInt(1, 7))
            : addDays(new Date(), randomInt(1, 14));
      const created = await taskService.createTask(admin._id.toString(), {
        title,
        description: `Demo task for workflow coverage: ${title}.`,
        priority,
        status,
        dueDate: dueDate.toISOString(),
        assignedTo: admin._id.toString(),
        relatedToType: "customer",
        relatedToId: relatedCustomer._id.toString(),
        _performedBy: "user",
      });
      tasks.push(created);
    }

    for (const task of tasks.slice(0, 8)) {
      await taskService.updateTaskByNumber(admin._id.toString(), Number(task.task_number), {
        status: pickOne(["in_progress", "done"]),
        priority: pickOne(["medium", "high"]),
        _performedBy: "user",
      });
      await createSeedHistory({
        userId: admin._id.toString(),
        entityType: "task",
        entityNumber: Number(task.task_number),
        actionType: "seed_task_update",
        source: "user",
        meta: { title: task.title },
      });
    }

    const randomizedSalesCount = 24;
    for (let i = 0; i < randomizedSalesCount; i += 1) {
      const customer = pickOne(customers);
      const saleProducts = pickSome(createdProducts, randomInt(1, 3));
      const items = saleProducts.map((product) => ({
        name: product.name,
        quantity: randomInt(1, 3),
        price: product.salePrice,
      }));
      const status = Math.random() > 0.5 ? "pending" : "paid";

      const sale = await saleService.createSale(admin._id.toString(), {
        customerId: customer._id.toString(),
        items,
        status,
        date: randomDateWithinDays(60).toISOString(),
        paymentMethod: pickOne(["card", "cash", "paypal", "other"]),
        _performedBy: "user",
      });

      if (sale.saleNumber) {
        await saleService.updateSaleFlexibleByNumber(admin._id.toString(), Number(sale.saleNumber), {
          assignedTo: admin._id.toString(),
          _performedBy: "user",
        });
      }

      await createSeedHistory({
        userId: admin._id.toString(),
        entityType: "sale",
        entityNumber: sale.saleNumber ? Number(sale.saleNumber) : undefined,
        actionType: "seed_sale_create",
        source: "system",
        meta: { total: sale.total, status: sale.status },
      });
    }

    // Ensure dashboard trend always has paid sales across the last 6 months.
    for (let m = 0; m < 6; m += 1) {
      const customer = pickOne(customers);
      const saleProducts = pickSome(createdProducts, randomInt(1, 2));
      const items = saleProducts.map((product) => ({
        name: product.name,
        quantity: randomInt(1, 3),
        price: product.salePrice,
      }));
      const anchor = new Date();
      anchor.setMonth(anchor.getMonth() - m, randomInt(3, 24));
      const sale = await saleService.createSale(admin._id.toString(), {
        customerId: customer._id.toString(),
        items,
        status: "paid",
        date: anchor.toISOString(),
        paymentMethod: pickOne(["card", "cash", "paypal"]),
        _performedBy: "user",
      });

      if (sale.saleNumber) {
        await saleService.updateSaleFlexibleByNumber(admin._id.toString(), Number(sale.saleNumber), {
          assignedTo: admin._id.toString(),
          _performedBy: "user",
        });
      }
    }

    const salesCount = randomizedSalesCount + 6;

    logger.info("Demo data seeded successfully", {
      storeId: DEMO_STORE_ID,
      adminEmail: DEMO_ADMIN_EMAIL,
      products: PRODUCT_SEEDS.length,
      customers: CUSTOMER_SEEDS.length,
      tasks: TASK_SEEDS.length,
      sales: salesCount,
    });
  } catch (error) {
    logger.error("demo_seed_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
