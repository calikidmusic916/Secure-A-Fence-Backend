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
      phone: "279-261-3890",
      isTaxable: true,
      businessAddress: "123 Perimeter Way, Sacramento, CA",
      jobsites: []
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

// Initial load from local file
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
    if (db.users?.length > 0) {
      const dbUsersPayload = db.users.map(u => {
        const copy = { ...u };
        if (!copy.passwordHash) {
          copy.passwordHash = '$2a$10$w0BInG8mPZf5m6Xp0w2v8OqU0N1c5eQ2W2X2Y2Z2a2b2c2d2e2f2g';
        }
        if (copy.isTaxable === undefined) copy.isTaxable = true;
        if (!copy.businessAddress) copy.businessAddress = '';
        if (!copy.jobsites) copy.jobsites = [];
        return copy;
      });
      const { error: err1 } = await supabase.from('users').upsert(dbUsersPayload);
      if (err1) {
        // Fallback to customers table if users table name in Supabase is customers
        const { error: err2 } = await supabase.from('customers').upsert(dbUsersPayload);
        if (err2) console.error('Supabase users/customers sync error:', err2.message);
      }
    }

    if (db.products?.length > 0) {
      const dbProductsPayload = db.products.map(p => {
        const copy = { ...p };
        if (!copy.unit) copy.unit = 'unit';
        if (copy.suspended === undefined || copy.suspended === null) copy.suspended = false;
        return copy;
      });
      const { error: prodErr } = await supabase.from('products').upsert(dbProductsPayload);
      if (prodErr) console.error('Supabase products upsert error:', prodErr.message);
    }

    if (db.orders?.length > 0) {
      const { error } = await supabase.from('orders').upsert(db.orders);
      if (error) console.error('Supabase orders sync error:', error.message);
    }

    if (db.rentals?.length > 0) {
      const { error } = await supabase.from('rentals').upsert(db.rentals);
      if (error) console.error('Supabase rentals sync error:', error.message);
    }

    if (db.shipments?.length > 0) {
      const { error } = await supabase.from('shipments').upsert(db.shipments);
      if (error) console.error('Supabase shipments sync error:', error.message);
    }

    if (db.invoices?.length > 0) {
      const { error } = await supabase.from('invoices').upsert(db.invoices);
      if (error) console.error('Supabase invoices sync error:', error.message);
    }

    console.log('Successfully synced data to Supabase.');
  } catch (err) {
    console.error('Supabase sync error:', err.message);
  }
}

// Hydrate DB from Supabase on startup without deleting local records
async function initDbFromSupabase() {
  if (!supabase) {
    console.log('No Supabase connection. Using local data.');
    isHydrated = true;
    return;
  }

  console.log('Connecting to Supabase to fetch persistent data...');
  try {
    let usersRes = await supabase.from('users').select('*');
    if (usersRes.error || !usersRes.data || usersRes.data.length === 0) {
      const custRes = await supabase.from('customers').select('*');
      if (custRes.data && custRes.data.length > 0) {
        usersRes = custRes;
      }
    }

    const [
      { data: products },
      { data: orders },
      { data: rentals },
      { data: shipments },
      { data: invoices }
    ] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('rentals').select('*'),
      supabase.from('shipments').select('*'),
      supabase.from('invoices').select('*')
    ]);

    const localDb = getLocalDb();

    if (usersRes.data && usersRes.data.length > 0) {
      const fetchedUsers = usersRes.data.map(u => ({
        ...u,
        jobsites: Array.isArray(u.jobsites) ? u.jobsites : (typeof u.jobsites === 'string' ? JSON.parse(u.jobsites) : []),
        isTaxable: u.isTaxable !== undefined ? Boolean(u.isTaxable) : true,
        businessAddress: u.businessAddress || ''
      }));

      // Merge Supabase users with localDb users
      const userMap = new Map();
      (localDb.users || []).forEach(u => userMap.set(u.id, u));
      fetchedUsers.forEach(u => userMap.set(u.id, u));
      cachedDb.users = Array.from(userMap.values());
    }

    if (products && products.length > 0) {
      const fetchedProducts = products.map(p => ({
        ...p,
        isRental: p.isRental !== undefined ? Boolean(p.isRental) : true,
        isPurchase: p.isPurchase !== undefined ? Boolean(p.isPurchase) : true
      }));

      const prodMap = new Map();
      (localDb.products || []).forEach(p => prodMap.set(p.id, p));
      fetchedProducts.forEach(p => prodMap.set(p.id, p));
      cachedDb.products = Array.from(prodMap.values());
    }

    if (orders && orders.length > 0) {
      const fetchedOrders = orders.map(o => ({
        ...o,
        isTaxable: o.isTaxable !== undefined ? Boolean(o.isTaxable) : true,
        discountAmount: parseFloat(o.discountAmount) || 0,
        overrideTotal: o.overrideTotal !== null && o.overrideTotal !== undefined ? parseFloat(o.overrideTotal) : null
      }));

      const orderMap = new Map();
      (localDb.orders || []).forEach(o => orderMap.set(o.id, o));
      fetchedOrders.forEach(o => orderMap.set(o.id, o));
      cachedDb.orders = Array.from(orderMap.values());
    }

    if (rentals && rentals.length > 0) {
      const rentalMap = new Map();
      (localDb.rentals || []).forEach(r => rentalMap.set(r.id, r));
      rentals.forEach(r => rentalMap.set(r.id, r));
      cachedDb.rentals = Array.from(rentalMap.values());
    }

    if (shipments && shipments.length > 0) {
      const fetchedShipments = shipments.map(s => ({
        ...s,
        isTaxable: s.isTaxable !== undefined ? Boolean(s.isTaxable) : true,
        discountAmount: parseFloat(s.discountAmount) || 0,
        overrideTotal: s.overrideTotal !== null && s.overrideTotal !== undefined ? parseFloat(s.overrideTotal) : null
      }));

      const shipMap = new Map();
      (localDb.shipments || []).forEach(s => shipMap.set(s.id, s));
      fetchedShipments.forEach(s => shipMap.set(s.id, s));
      cachedDb.shipments = Array.from(shipMap.values());
    }

    if (invoices && invoices.length > 0) {
      const invMap = new Map();
      (localDb.invoices || []).forEach(inv => invMap.set(inv.id, inv));
      invoices.forEach(inv => invMap.set(inv.id, inv));
      cachedDb.invoices = Array.from(invMap.values());
    }

    console.log(`Persistence check: Loaded ${cachedDb.products?.length || 0} products, ${cachedDb.orders?.length || 0} orders, and ${cachedDb.users?.length || 0} users.`);
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
  syncToSupabase
};
