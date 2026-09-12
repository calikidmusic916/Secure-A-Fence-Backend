let createClient;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {
  createClient = null;
}

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = (createClient && SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

if (!supabase) {
  console.warn('⚠️ Supabase credentials missing. Running in local-only mode.');
}

const LOCAL_DB_PATH = path.join(__dirname, 'data', 'db.json');

const initialData = {
  users: [
    {
      id: "admin-1",
      name: "Site Manager Admin",
      email: "admin@secureafence.com",
      passwordHash: "$2a$10$w0BInG8mPZf5m6Xp0w2v8OqU0N1c5eQ2W2X2Y2Z2a2b2c2d2e2f2g",
      role: "admin",
      company: "Secure-A-Fence Operations",
      phone: "279-261-3890"
    },
    {
      id: "cust-1",
      name: "John Builder",
      email: "john@apexconstruction.com",
      passwordHash: "$2a$10$w0BInG8mPZf5m6Xp0w2v8OqU0N1c5eQ2W2X2Y2Z2a2b2c2d2e2f2g",
      role: "customer",
      company: "Apex Construction Services",
      phone: "(555) 234-5678"
    }
  ],
  products: [
    {
      id: "prod-panel-6x12",
      name: "Refurbished Temporary Fence Panel (6' x 12')",
      category: "sales",
      type: "panel",
      salePrice: 65.00,
      rentalPriceMonthly: 15.00,
      inStock: 300,
      rentedCount: 90,
      description: "Heavy-duty 11-gauge galvanized chain-link mesh with sturdy welded tubular steel frame (6ft x 12ft). Fully refurbished and cross-braced.",
      image: "/assets/panel.png",
      specs: "Dimensions: 6 ft High x 12 ft Wide | Frame: 1-3/8\" OD Steel | Mesh: 2-3/8\" Galvanized"
    },
    {
      id: "prod-panel-6x10",
      name: "Refurbished Temporary Fence Panel (6' x 10')",
      category: "sales",
      type: "panel",
      salePrice: 50.00,
      rentalPriceMonthly: 12.00,
      inStock: 250,
      rentedCount: 60,
      description: "Standard 6ft x 10ft refurbished temporary chain-link fence panel. Ideal for tighter perimeters and flexible jobsite layouts.",
      image: "/assets/panel.png",
      specs: "Dimensions: 6 ft High x 10 ft Wide | Frame: 1-3/8\" OD Steel | Mesh: 2-3/8\" Galvanized"
    },
    {
      id: "prod-stand-sale",
      name: "Flat Stand (Standard Tubular Base)",
      category: "sales",
      type: "stand",
      salePrice: 10.00,
      rentalPriceMonthly: 3.00,
      inStock: 600,
      rentedCount: 130,
      description: "Lightweight rectangular tubular steel base with dual upright sleeves.",
      image: "/assets/stand.png",
      specs: "Style: Flat Stand | Dimensions: 36\" x 16\" | Weight: 24 lbs"
    },
    {
      id: "prod-clip-sale",
      name: "Safety Clamp / Panel Connector Clip",
      category: "sales",
      type: "clip",
      salePrice: 5.00,
      rentalPriceMonthly: 1.00,
      inStock: 1200,
      rentedCount: 260,
      description: "High-tensile steel coupler clamp used to join adjacent fence panels together.",
      image: "/assets/clip.webp",
      specs: "Material: Forged Steel | Bolt: 1/2\" Galvanized Carriage Bolt"
    }
  ],
  orders: [],
  rentals: [],
  shipments: [],
  invoices: []
};

function getLocalDb() {
  try {
    if (fs.existsSync(LOCAL_DB_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Local DB read error:', e);
  }
  return initialData;
}

let cachedDb = getLocalDb();

function getDb() {
  return cachedDb;
}

function saveDb(data) {
  cachedDb = data;
  try {
    const dir = path.dirname(LOCAL_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Local DB save error:', e);
  }

  // Asynchronously sync data to Supabase
  syncToSupabase(data).catch(err => console.error('Supabase sync error:', err.message));
}

async function syncToSupabase(db) {
  if (!supabase) return;
  try {
    if (db.users && db.users.length > 0) {
      await supabase.from('users').upsert(db.users);
    }
    if (db.products && db.products.length > 0) {
      await supabase.from('products').upsert(db.products);
    }
    if (db.orders && db.orders.length > 0) {
      await supabase.from('orders').upsert(db.orders);
    }
    if (db.rentals && db.rentals.length > 0) {
      await supabase.from('rentals').upsert(db.rentals);
    }
    if (db.shipments && db.shipments.length > 0) {
      await supabase.from('shipments').upsert(db.shipments);
    }
  } catch (err) {
    console.error('Supabase sync error:', err.message);
  }
}

// Hydrate DB from Supabase on startup
async function initDbFromSupabase() {
  if (!supabase) return;
  try {
    const { data: users } = await supabase.from('users').select('*');
    const { data: products } = await supabase.from('products').select('*');
    const { data: orders } = await supabase.from('orders').select('*');
    const { data: rentals } = await supabase.from('rentals').select('*');
    const { data: shipments } = await supabase.from('shipments').select('*');

    if (users && users.length > 0) cachedDb.users = users;
    if (products && products.length > 0) cachedDb.products = products;
    if (orders && orders.length > 0) cachedDb.orders = orders;
    if (rentals && rentals.length > 0) cachedDb.rentals = rentals;
    if (shipments && shipments.length > 0) cachedDb.shipments = shipments;
  } catch (e) {
    console.log('Starting with cached local data.');
  }
}

initDbFromSupabase();

module.exports = {
  getDb,
  saveDb
};
