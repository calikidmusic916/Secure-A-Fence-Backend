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
        copy.is_taxable = copy.isTaxable;
        if (!copy.businessAddress) copy.businessAddress = '';
        copy.business_address = copy.businessAddress;
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
        copy.sale_price = copy.salePrice;
        copy.rental_price_monthly = copy.rentalPriceMonthly;
        copy.in_stock = copy.inStock;
        copy.rented_count = copy.rentedCount;
        copy.is_rental = copy.isRental;
        copy.is_purchase = copy.isPurchase;
        return copy;
      });
      const { error: prodErr } = await supabase.from('products').upsert(dbProductsPayload);
      if (prodErr) console.error('Supabase products upsert error:', prodErr.message);
    }

    if (db.orders?.length > 0) {
      const dbOrdersPayload = db.orders.map(o => {
        const copy = { ...o };
        copy.customer_id = copy.customerId;
        copy.customer_name = copy.customerName;
        copy.customer_company = copy.customerCompany;
        copy.customer_email = copy.customerEmail;
        copy.customer_phone = copy.customerPhone;
        copy.order_type = copy.orderType;
        copy.delivery_fee = copy.deliveryFee;
        copy.total_amount = copy.totalAmount;
        copy.delivery_address = copy.deliveryAddress;
        copy.jobsite_contact = copy.jobsiteContact;
        copy.delivery_date = copy.deliveryDate;
        copy.payment_status = copy.paymentStatus;
        copy.payment_method = copy.paymentMethod;
        copy.is_taxable = copy.isTaxable;
        copy.discount_amount = copy.discountAmount;
        copy.override_total = copy.overrideTotal;
        return copy;
      });
      const { error } = await supabase.from('orders').upsert(dbOrdersPayload);
      if (error) console.error('Supabase orders sync error:', error.message);
    }

    if (db.rentals?.length > 0) {
      const dbRentalsPayload = db.rentals.map(r => {
        const copy = { ...r };
        copy.order_id = copy.orderId;
        copy.customer_id = copy.customerId;
        copy.customer_name = copy.customerName;
        copy.customer_company = copy.customerCompany;
        copy.customer_email = copy.customerEmail;
        copy.customer_phone = copy.customerPhone;
        copy.jobsite_address = copy.jobsiteAddress;
        copy.jobsite_contact = copy.jobsiteContact;
        copy.start_date = copy.startDate;
        copy.end_date = copy.endDate;
        copy.monthly_rate_total = copy.monthlyRateTotal;
        return copy;
      });
      const { error } = await supabase.from('rentals').upsert(dbRentalsPayload);
      if (error) console.error('Supabase rentals sync error:', error.message);
    }

    if (db.shipments?.length > 0) {
      const dbShipmentsPayload = db.shipments.map(s => {
        const copy = { ...s };
        copy.order_id = copy.orderId;
        copy.driver_name = copy.driverName;
        copy.dispatch_date = copy.dispatchDate;
        copy.delivery_photos = copy.deliveryPhotos;
        copy.delivered_items = copy.deliveredItems;
        copy.is_taxable = copy.isTaxable;
        copy.discount_amount = copy.discountAmount;
        copy.override_total = copy.overrideTotal;
        return copy;
      });
      const { error } = await supabase.from('shipments').upsert(dbShipmentsPayload);
      if (error) console.error('Supabase shipments sync error:', error.message);
    }

    if (db.invoices?.length > 0) {
      const dbInvoicesPayload = db.invoices.map(inv => {
        const copy = { ...inv };
        copy.order_id = copy.orderId;
        copy.customer_name = copy.customerName;
        return copy;
      });
      const { error } = await supabase.from('invoices').upsert(dbInvoicesPayload);
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
        isTaxable: u.isTaxable !== undefined ? Boolean(u.isTaxable) : (u.is_taxable !== undefined ? Boolean(u.is_taxable) : true),
        businessAddress: u.businessAddress || u.business_address || ''
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
        salePrice: p.salePrice !== undefined ? parseFloat(p.salePrice) : (parseFloat(p.sale_price) || 0),
        rentalPriceMonthly: p.rentalPriceMonthly !== undefined ? parseFloat(p.rentalPriceMonthly) : (parseFloat(p.rental_price_monthly) || 0),
        inStock: p.inStock !== undefined ? parseInt(p.inStock) : (parseInt(p.in_stock) || 0),
        rentedCount: p.rentedCount !== undefined ? parseInt(p.rentedCount) : (parseInt(p.rented_count) || 0),
        isRental: p.isRental !== undefined ? Boolean(p.isRental) : (p.is_rental !== undefined ? Boolean(p.is_rental) : true),
        isPurchase: p.isPurchase !== undefined ? Boolean(p.isPurchase) : (p.is_purchase !== undefined ? Boolean(p.is_purchase) : true)
      }));

      const prodMap = new Map();
      (localDb.products || []).forEach(p => prodMap.set(p.id, p));
      fetchedProducts.forEach(p => prodMap.set(p.id, p));
      cachedDb.products = Array.from(prodMap.values());
    }

    if (orders && orders.length > 0) {
      const fetchedOrders = orders.map(o => ({
        ...o,
        customerId: o.customerId || o.customer_id || '',
        customerName: o.customerName || o.customer_name || '',
        customerCompany: o.customerCompany || o.customer_company || '',
        customerEmail: o.customerEmail || o.customer_email || '',
        customerPhone: o.customerPhone || o.customer_phone || '',
        orderType: o.orderType || o.order_type || 'sale',
        deliveryFee: o.deliveryFee !== undefined ? parseFloat(o.deliveryFee) : (parseFloat(o.delivery_fee) || 0),
        totalAmount: o.totalAmount !== undefined ? parseFloat(o.totalAmount) : (parseFloat(o.total_amount) || 0),
        deliveryAddress: o.deliveryAddress || o.delivery_address || '',
        paymentStatus: o.paymentStatus || o.payment_status || 'Unpaid',
        paymentMethod: o.paymentMethod || o.payment_method || 'None',
        isTaxable: o.isTaxable !== undefined ? Boolean(o.isTaxable) : (o.is_taxable !== undefined ? Boolean(o.is_taxable) : true),
        discountAmount: o.discountAmount !== undefined ? parseFloat(o.discountAmount) : (parseFloat(o.discount_amount) || 0),
        overrideTotal: o.overrideTotal !== null && o.overrideTotal !== undefined ? parseFloat(o.overrideTotal) : (o.override_total !== null && o.override_total !== undefined ? parseFloat(o.override_total) : null)
      }));

      const orderMap = new Map();
      (localDb.orders || []).forEach(o => orderMap.set(o.id, o));
      fetchedOrders.forEach(o => orderMap.set(o.id, o));
      cachedDb.orders = Array.from(orderMap.values());
    }

    if (rentals && rentals.length > 0) {
      const fetchedRentals = rentals.map(r => ({
        ...r,
        orderId: r.orderId || r.order_id || '',
        customerId: r.customerId || r.customer_id || '',
        customerName: r.customerName || r.customer_name || '',
        customerCompany: r.customerCompany || r.customer_company || '',
        customerEmail: r.customerEmail || r.customer_email || '',
        customerPhone: r.customerPhone || r.customer_phone || '',
        jobsiteAddress: r.jobsiteAddress || r.jobsite_address || '',
        jobsiteContact: r.jobsiteContact || r.jobsite_contact || '',
        startDate: r.startDate || r.start_date || '',
        endDate: r.endDate || r.end_date || '',
        monthlyRateTotal: r.monthlyRateTotal !== undefined ? parseFloat(r.monthlyRateTotal) : (parseFloat(r.monthly_rate_total) || 0)
      }));

      const rentalMap = new Map();
      (localDb.rentals || []).forEach(r => rentalMap.set(r.id, r));
      fetchedRentals.forEach(r => rentalMap.set(r.id, r));
      cachedDb.rentals = Array.from(rentalMap.values());
    }

    if (shipments && shipments.length > 0) {
      const fetchedShipments = shipments.map(s => ({
        ...s,
        orderId: s.orderId || s.order_id || '',
        driverName: s.driverName || s.driver_name || '',
        dispatchDate: s.dispatchDate || s.dispatch_date || '',
        deliveryPhotos: Array.isArray(s.deliveryPhotos) ? s.deliveryPhotos : (Array.isArray(s.delivery_photos) ? s.delivery_photos : []),
        deliveredItems: Array.isArray(s.deliveredItems) ? s.deliveredItems : (Array.isArray(s.delivered_items) ? s.delivered_items : []),
        isTaxable: s.isTaxable !== undefined ? Boolean(s.isTaxable) : (s.is_taxable !== undefined ? Boolean(s.is_taxable) : true),
        discountAmount: s.discountAmount !== undefined ? parseFloat(s.discountAmount) : (parseFloat(s.discount_amount) || 0),
        overrideTotal: s.overrideTotal !== null && s.overrideTotal !== undefined ? parseFloat(s.overrideTotal) : (s.override_total !== null && s.override_total !== undefined ? parseFloat(s.override_total) : null)
      }));

      const shipMap = new Map();
      (localDb.shipments || []).forEach(s => shipMap.set(s.id, s));
      fetchedShipments.forEach(s => shipMap.set(s.id, s));
      cachedDb.shipments = Array.from(shipMap.values());
    }

    if (invoices && invoices.length > 0) {
      const fetchedInvoices = invoices.map(inv => ({
        ...inv,
        orderId: inv.orderId || inv.order_id || '',
        customerName: inv.customerName || inv.customer_name || ''
      }));

      const invMap = new Map();
      (localDb.invoices || []).forEach(inv => invMap.set(inv.id, inv));
      fetchedInvoices.forEach(inv => invMap.set(inv.id, inv));
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
