// Polyfill WebSocket for Node.js environment (required for Supabase Realtime on Render)
try {
  global.WebSocket = require('ws');
} catch (e) {
  // ws might not be installed yet during the very first build step
}

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
  console.warn('⚠️ Supabase credentials missing or client failed to initialize. Running in local-only mode.');
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
    }
  ],
  products: [],
  orders: [],
  rentals: [],
  shipments: [],
  invoices: []
};

let cachedDb = initialData;
let isHydrated = false;

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

// Initial load from local file (if exists)
cachedDb = getLocalDb();

function getDb() {
  return cachedDb;
}

async function saveDb(data) {
  cachedDb = data;
  try {
    const dir = path.dirname(LOCAL_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Local DB save error:', e);
  }

  // Synchronously wait for Supabase sync to ensure data persistence
  await syncToSupabase(data);
}

async function syncToSupabase(db) {
  if (!supabase) return;
  try {
    const syncTasks = [];

    if (db.users?.length > 0) syncTasks.push(supabase.from('users').upsert(db.users));

    if (db.products?.length > 0) {
      // Safely attempt upsert, ignoring missing columns if they cause errors
      syncTasks.push(
        supabase.from('products').upsert(db.products).then(({ error }) => {
          if (error && error.code === 'PGRST204') {
            console.warn('Columns missing in Supabase. Upserting with stripped fields...');
            const stripped = db.products.map(p => {
              const copy = { ...p };
              delete copy.suspended;
              delete copy.unit;
              return copy;
            });
            return supabase.from('products').upsert(stripped);
          }
        })
      );
    }

    if (db.orders?.length > 0) syncTasks.push(supabase.from('orders').upsert(db.orders));
    if (db.rentals?.length > 0) syncTasks.push(supabase.from('rentals').upsert(db.rentals));
    if (db.shipments?.length > 0) syncTasks.push(supabase.from('shipments').upsert(db.shipments));
    if (db.invoices?.length > 0) syncTasks.push(supabase.from('invoices').upsert(db.invoices));

    await Promise.all(syncTasks);
    console.log('Successfully synced data to Supabase.');
  } catch (err) {
    console.error('Supabase sync error:', err.message);
  }
}

// Hydrate DB from Supabase on startup
async function initDbFromSupabase() {
  if (!supabase) {
    console.log('No Supabase connection. Using local data.');
    isHydrated = true;
    return;
  }

  console.log('Connecting to Supabase to fetch persistent data...');
  try {
    const [
      { data: users },
      { data: products },
      { data: orders },
      { data: rentals },
      { data: shipments },
      { data: invoices }
    ] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('products').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('rentals').select('*'),
      supabase.from('shipments').select('*'),
      supabase.from('invoices').select('*')
    ]);

    if (users) cachedDb.users = users;
    if (products) cachedDb.products = products;
    if (orders) cachedDb.orders = orders;
    if (rentals) cachedDb.rentals = rentals;
    if (shipments) cachedDb.shipments = shipments;
    if (invoices) cachedDb.invoices = invoices;

    console.log(`Persistence check: Loaded ${cachedDb.orders?.length || 0} orders and ${cachedDb.users?.length || 0} users from Supabase.`);
    isHydrated = true;
  } catch (e) {
    console.error('Supabase hydration error:', e.message);
    console.log('Falling back to local data.');
    isHydrated = true;
  }
}

module.exports = {
  getDb,
  saveDb,
  initDbFromSupabase,
  isReady: () => isHydrated,
  supabase
};
