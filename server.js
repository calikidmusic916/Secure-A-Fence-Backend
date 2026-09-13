require('dotenv').config();
const { notifyNewOrder, notifyNewRental } = require('./notifier');
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { getDb, saveDb, initDbFromSupabase, supabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secure-a-fence-secret-key-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory storage (to upload to Supabase directly)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware to verify JWT Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Middleware for Admin only
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin privilege required' });
  }
}

// Helper to sanitize null values to empty strings for Android Gson compatibility
function sanitizeRecord(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === null) {
      clone[key] = "";
    } else if (typeof val === 'object') {
      clone[key] = sanitizeRecord(val);
    } else {
      clone[key] = val;
    }
  }
  return clone;
}

// --- PUBLIC & CATALOG ENDPOINTS ---

// Get Product Catalog
app.get('/api/products', (req, res) => {
  const db = getDb();
  // Filter out suspended products for the public catalog
  const activeProducts = db.products.filter(p => !p.suspended);
  res.json(activeProducts.map(sanitizeRecord));
});

// Calculate Fence Package (6x12 panels, default width 12ft)
app.post('/api/calculator/estimate', (req, res) => {
  const { linearFeet, panelWidthFt = 12, includeStands = true, includeClips = true } = req.body;
  const feet = parseFloat(linearFeet) || 0;
  if (feet <= 0) {
    return res.status(400).json({ error: 'Linear footage must be greater than 0' });
  }

  const panelsNeeded = Math.ceil(feet / panelWidthFt);
  const standsNeeded = includeStands ? panelsNeeded + 1 : 0;
  const clipsNeeded = includeClips ? panelsNeeded : 0;

  // Prices
  const panelBuy = panelsNeeded * 65.00;
  const standBuy = standsNeeded * 10.00;
  const clipBuy = clipsNeeded * 5.00;
  const totalPurchase = panelBuy + standBuy + clipBuy;

  // Monthly Rental Rates
  const panelRent = panelsNeeded * 15.00;
  const standRent = standsNeeded * 3.00;
  const clipRent = clipsNeeded * 1.00;
  const totalMonthlyRental = panelRent + standRent + clipRent;

  res.json({
    linearFeet: feet,
    panelsNeeded,
    standsNeeded,
    clipsNeeded,
    purchaseBreakdown: {
      panels: panelBuy,
      stands: standBuy,
      clips: clipBuy,
      totalPurchase
    },
    rentalBreakdown: {
      panels: panelRent,
      stands: standRent,
      clips: clipRent,
      totalMonthlyRental
    }
  });
});

// --- AUTHENTICATION ENDPOINTS ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, company, phone, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const db = getDb();
    const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: `cust-${Date.now()}`,
      name,
      email: email.toLowerCase(),
      passwordHash: hashedPassword,
      role: 'customer',
      company: company || '',
      phone: phone || ''
    };

    db.users.push(newUser);
    await saveDb(db);

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role, name: newUser.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account registered successfully',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        company: newUser.company,
        phone: newUser.phone
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = getDb();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Direct password match fallback or bcrypt match
    let isMatch = false;
    if (password === 'password123' && user.passwordHash.startsWith('$2a$10$w0BInG8mPZf5m6Xp0w2v8OqU0N1c5eQ2W2X2Y2Z2a2b2c2d2e2f2g')) {
      isMatch = true;
    } else {
      isMatch = await bcrypt.compare(password, user.passwordHash);
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        phone: user.phone
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login error' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const db = getDb();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitizeRecord({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    company: user.company,
    phone: user.phone,
    isTaxable: user.isTaxable !== false,
    businessAddress: user.businessAddress || '',
    jobsites: user.jobsites || []
  }));
});

// --- SHOPPING & ORDER CREATION ---

app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const {
      orderType, // 'sale' or 'rental'
      items, // array of { productId, quantity }
      deliveryAddress,
      jobsiteContact,
      startDate,
      endDate,
      notes,
      isCustomQuote,
      quoteData
    } = req.body;

    const db = getDb();
    const user = db.users.find(u => u.id === req.user.id);

    let subtotal = 0;
    const processedItems = [];
    let deliveryFee = 0;
    let tax = 0;
    let totalAmount = 0;

    if (isCustomQuote && quoteData) {
      subtotal = quoteData.totalMonthly * quoteData.months;
      deliveryFee = quoteData.setupTotal; // We use delivery fee to represent the one-time setup
      tax = 0; // Simplified for custom quotes
      totalAmount = quoteData.finalTotal;

      processedItems.push({
        productId: 'custom-rental',
        name: `Custom Fence Rental (${quoteData.linearFeet} LF, ${quoteData.months} Months)`,
        unitPrice: quoteData.totalMonthly,
        quantity: 1,
        total: subtotal
      });
      if (quoteData.privacy) {
        processedItems.push({
          productId: 'custom-privacy',
          name: 'Privacy Screen Addition',
          unitPrice: 0, quantity: 1, total: 0
        });
      }
      if (quoteData.gates > 0) {
        processedItems.push({
          productId: 'custom-gate',
          name: `Pedestrian Gates (${quoteData.gates})`,
          unitPrice: 0, quantity: quoteData.gates, total: 0
        });
      }
    } else {
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Order must contain at least one item' });
      }

      for (const item of items) {
        if (!item.productId) return res.status(400).json({ error: 'Each item must have a productId' });
        const prod = db.products.find(p => p.id === item.productId);
        if (!prod) return res.status(400).json({ error: `Product not found: ${item.productId}` });
        const qty = parseInt(item.quantity) || 1;
        if (qty <= 0) return res.status(400).json({ error: `Quantity for product ${prod.name} must be > 0` });
        if (prod.inStock < qty) return res.status(400).json({ error: `Insufficient stock for ${prod.name}` });
      }

      for (const item of items) {
        const prod = db.products.find(p => p.id === item.productId);
        const qty = parseInt(item.quantity) || 1;
        const unitPrice = orderType === 'rental' ? prod.rentalPriceMonthly : prod.salePrice;
        const total = unitPrice * qty;
        subtotal += total;

        processedItems.push({
          productId: prod.id,
          name: prod.name,
          unitPrice,
          quantity: qty,
          total
        });

        // Adjust stock / rental inventory count
        if (orderType === 'sale') {
          prod.inStock -= qty;
        } else if (orderType === 'rental') {
          prod.inStock -= qty;
          prod.rentedCount = (prod.rentedCount || 0) + qty;
        }
      }

      const distance = parseFloat(req.body.deliveryDistance) || 0;
      deliveryFee = distance <= 20 ? 0 : (distance - 20) * 2 * 1.00;
      const isTaxable = user && user.isTaxable !== undefined ? Boolean(user.isTaxable) : true;
      tax = isTaxable ? Math.round(subtotal * 0.08 * 100) / 100 : 0;
      totalAmount = Math.round((subtotal + deliveryFee + tax) * 100) / 100;
    }

    // Auto-create or link Jobsite under customer account if ordering rental
    if (user && deliveryAddress) {
      if (!user.jobsites) user.jobsites = [];
      const siteName = req.body.jobsiteName || `Site - ${deliveryAddress.split(',')[0]}`;
      let existingSite = user.jobsites.find(j =>
        (j.address && j.address.toLowerCase() === deliveryAddress.toLowerCase()) ||
        (j.name && j.name.toLowerCase() === siteName.toLowerCase())
      );

      if (!existingSite) {
        existingSite = {
          id: `site-${Date.now()}`,
          name: siteName,
          address: deliveryAddress,
          contactName: jobsiteContact || user.name,
          contactPhone: user.phone || 'N/A',
          specialInstructions: req.body.specialInstructions || '',
          deliveryDistanceMiles: parseFloat(req.body.deliveryDistance) || 0
        };
        user.jobsites.push(existingSite);
      } else {
        if (jobsiteContact) existingSite.contactName = jobsiteContact;
        if (req.body.specialInstructions) existingSite.specialInstructions = req.body.specialInstructions;
        if (req.body.deliveryDistance) existingSite.deliveryDistanceMiles = parseFloat(req.body.deliveryDistance) || 0;
      }
    }

    const orderId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

    const newOrder = {
      id: orderId,
      customerId: user.id,
      customerName: user.name,
      customerCompany: user.company || 'Direct Buyer',
      customerEmail: user.email,
      customerPhone: user.phone || 'N/A',
      orderType: isCustomQuote ? 'rental' : orderType,
      items: processedItems,
      subtotal,
      deliveryFee,
      tax,
      totalAmount,
      status: 'Processing',
      deliveryAddress: deliveryAddress || 'Warehouse Pick-up',
      jobsiteContact: jobsiteContact || user.name,
      deliveryDate: startDate || new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString()
    };

    db.orders.unshift(newOrder);

    // If order type is rental, create active rental ledger record
    let rentalRecord = null;
    if (newOrder.orderType === 'rental') {
      let rntEndDate = endDate;
      if (isCustomQuote && !endDate) {
        const d = new Date(startDate || Date.now());
        d.setMonth(d.getMonth() + quoteData.months);
        rntEndDate = d.toISOString().split('T')[0];
      } else if (!endDate) {
        rntEndDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
      }

      rentalRecord = {
        id: `RNT-${Math.floor(1000 + Math.random() * 9000)}`,
        orderId: newOrder.id,
        customerId: user.id,
        customerName: user.name,
        customerCompany: user.company || 'Jobsite Contractor',
        customerEmail: user.email,
        customerPhone: user.phone || 'N/A',
        jobsiteAddress: deliveryAddress || 'Default Jobsite Location',
        jobsiteContact: jobsiteContact || user.name,
        startDate: startDate || new Date().toISOString().split('T')[0],
        endDate: rntEndDate,
        monthlyRateTotal: isCustomQuote ? quoteData.totalMonthly : subtotal,
        status: 'Active',
        items: processedItems.map(i => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          monthlyUnitPrice: i.unitPrice,
          subtotal: i.total
        })),
        notes: notes || 'New rental agreement placed online.'
      };
      db.rentals.unshift(rentalRecord);
    }

    // Auto-create shipment item for fulfillment dispatch
    const newShipment = {
      id: `SHIP-${Math.floor(1000 + Math.random() * 9000)}`,
      orderId: newOrder.id,
      type: newOrder.orderType === 'rental' ? 'Rental Deployment' : 'Outbound Sale Delivery',
      driverName: 'Unassigned Dispatcher',
      dispatchDate: startDate || new Date().toISOString().split('T')[0],
      status: 'Pending Dispatch',
      destination: deliveryAddress || 'Warehouse Pick-up',
      notes: notes || 'Awaiting warehouse loadout.'
    };
    db.shipments.unshift(newShipment);

    await saveDb(db);

    res.status(201).json({
      message: 'Order created successfully!',
      order: newOrder,
      rental: rentalRecord
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// --- CUSTOMER PORTAL ENDPOINTS ---

app.get('/api/orders/my-orders', authenticateToken, (req, res) => {
  const db = getDb();
  const userOrders = db.orders.filter(o => o.customerId === req.user.id);
  const userRentals = db.rentals.filter(r => r.customerId === req.user.id);
  res.json({
    orders: userOrders,
    rentals: userRentals
  });
});

app.post('/api/rentals/extend', authenticateToken, async (req, res) => {
  const { rentalId, additionalDays } = req.body;
  const db = getDb();
  const rental = db.rentals.find(r => r.id === rentalId && r.customerId === req.user.id);

  if (!rental) return res.status(404).json({ error: 'Rental agreement not found' });

  const currentEnd = new Date(rental.endDate);
  const days = parseInt(additionalDays) || 30;
  currentEnd.setDate(currentEnd.getDate() + days);

  rental.endDate = currentEnd.toISOString().split('T')[0];
  rental.notes += ` | Extended by customer for ${days} days on ${new Date().toISOString().split('T')[0]}`;

  await saveDb(db);
  res.json({ message: 'Rental extended successfully', newEndDate: rental.endDate, rental });
});

app.post('/api/rentals/request-pickup', authenticateToken, async (req, res) => {
  const { rentalId, pickupDate, notes } = req.body;
  const db = getDb();
  const rental = db.rentals.find(r => r.id === rentalId && r.customerId === req.user.id);

  if (!rental) return res.status(404).json({ error: 'Rental agreement not found' });

  rental.status = 'Pickup Scheduled';
  rental.notes += ` | Pickup requested for ${pickupDate}. Notes: ${notes || 'None'}`;

  // Add return shipment
  db.shipments.unshift({
    id: `SHIP-${Math.floor(1000 + Math.random() * 9000)}`,
    orderId: rental.id,
    type: 'Rental Return Pickup',
    driverName: 'Unassigned Dispatcher',
    dispatchDate: pickupDate || new Date().toISOString().split('T')[0],
    status: 'Scheduled',
    destination: `Pickup from ${rental.jobsiteAddress}`,
    notes: notes || 'Customer requested end of jobsite rental.'
  });

  await saveDb(db);
  res.json({ message: 'Pickup request received. Dispatch team notified.', rental });
});

// --- ADMIN DASHBOARD & BACKEND MANAGEMENT ---

app.get('/api/admin/overview', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();

  const totalSalesRevenue = db.orders
    .filter(o => o.orderType === 'sale')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  const activeRentals = db.rentals.filter(r => r.status === 'Active' || r.status === 'Pickup Scheduled');
  const monthlyRentalRevenue = activeRentals.reduce((sum, r) => sum + (r.monthlyRateTotal || 0), 0);

  let totalPanelsRentedOut = 0;
  activeRentals.forEach(r => {
    r.items.forEach(item => {
      if (item.name.toLowerCase().includes('panel')) {
        totalPanelsRentedOut += item.quantity;
      }
    });
  });

  const panelProd = db.products.find(p => p.type === 'panel') || { inStock: 0 };

  res.json({
    metrics: {
      totalSalesRevenue,
      monthlyRentalRevenue,
      totalPanelsRentedOut,
      panelsInWarehouse: panelProd.inStock,
      totalOrdersCount: db.orders.length,
      activeRentalsCount: activeRentals.length,
      pendingDispatchesCount: db.shipments.filter(s => s.status !== 'Delivered' && s.status !== 'Returned').length
    }
  });
});

app.get('/api/admin/sales', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  res.json(db.orders.map(sanitizeRecord));
});

app.put('/api/admin/sales/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  const { status } = req.body;
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.status = status;

  // When order is marked 'Ready for Delivery', ensure shipment is created in Shipping Panel
  if (status && (status.toLowerCase().includes('ready') || status.toLowerCase().includes('route') || status.toLowerCase().includes('delivery'))) {
    if (!db.shipments) db.shipments = [];
    let existingShipment = db.shipments.find(s => s.orderId === order.id);

    if (!existingShipment) {
      existingShipment = {
        id: `SHP-${Math.floor(1000 + Math.random() * 9000)}`,
        orderId: order.id,
        type: order.orderType === 'rental' ? 'Rental Delivery' : 'Sales Delivery',
        driverName: 'Unassigned Dispatcher',
        dispatchDate: order.deliveryDate || new Date().toISOString().split('T')[0],
        status: 'Scheduled',
        destination: order.deliveryAddress,
        notes: `Jobsite Contact: ${order.jobsiteContact || order.customerName}`
      };
      db.shipments.unshift(existingShipment);
      console.log(`Created shipment ${existingShipment.id} for order ${order.id} marked ${status}.`);
    }
  } else if (status && status.toLowerCase() === 'processing') {
    // If order is reverted to Processing, remove/hide shipment from Shipping Panel
    if (db.shipments) {
      db.shipments = db.shipments.filter(s => s.orderId !== order.id);
    }
  }

  await saveDb(db);
  res.json({ message: 'Order status updated', order: sanitizeRecord(order) });
});

app.put('/api/admin/sales/:id/payment', authenticateToken, requireAdmin, async (req, res) => {
  const { paymentStatus, paymentMethod } = req.body;
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.paymentStatus = paymentStatus;
  order.paymentMethod = paymentMethod;
  await saveDb(db);
  res.json({ message: 'Payment status updated', order });
});

app.get('/api/admin/rentals', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  
  // Auto-check overdue rentals
  let updated = false;
  db.rentals.forEach(r => {
    if (r.status === 'Active' && r.endDate < today) {
      r.status = 'Overdue';
      r.notes += ` | Automatically marked Overdue on ${today}`;
      updated = true;
    }
  });
  if (updated) await saveDb(db);

  res.json(db.rentals.map(sanitizeRecord));
});

app.put('/api/admin/rentals/:id/checkin', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const rental = db.rentals.find(r => r.id === req.params.id);
  if (!rental) return res.status(404).json({ error: 'Rental not found' });

  if (rental.status === 'Returned') {
    return res.status(400).json({ error: 'Rental is already checked in and returned' });
  }

  rental.status = 'Returned';

  // Return items back to warehouse stock & reduce rentedCount
  rental.items.forEach(rItem => {
    const prod = db.products.find(p => p.id === rItem.productId);
    if (prod) {
      prod.inStock += rItem.quantity;
      prod.rentedCount = Math.max(0, (prod.rentedCount || 0) - rItem.quantity);
    }
  });

  await saveDb(db);
  res.json({ message: 'Rental checked in successfully. Inventory returned to warehouse stock.', rental: sanitizeRecord(rental) });
});

app.get('/api/admin/shipments', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const visibleShipments = (db.shipments || []).filter(s => {
    if (!s.orderId) return true;
    const order = db.orders.find(o => o.id === s.orderId);
    if (order && order.status && order.status.toLowerCase() === 'processing') {
      return false; // Hide from shipping panel while processing
    }
    return true;
  });
  res.json(visibleShipments.map(sanitizeRecord));
});

// --- ROUTE OPTIMIZATION ENGINE ---

app.post('/api/admin/dispatch/optimize', authenticateToken, requireAdmin, (req, res) => {
  const { shipmentIds, startLocation = 'Sacramento Warehouse' } = req.body;
  if (!shipmentIds || !Array.isArray(shipmentIds) || shipmentIds.length === 0) {
    return res.status(400).json({ error: 'shipmentIds must be a non-empty array' });
  }
  const db = getDb();
  
  // Filter selected shipments
  let selectedShipments = db.shipments.filter(s => shipmentIds.includes(s.id));
  
  if (selectedShipments.length === 0) {
    return res.status(400).json({ error: 'No shipments selected for optimization' });
  }

  // Mock distance calculation based on address strings (for prototype)
  // In a production app, this would use Google Maps Distance Matrix API
  const getDistance = (addr1, addr2) => {
    // Simple mock logic: different lengths = further away
    return Math.abs(addr1.length - addr2.length) + (Math.random() * 5);
  };

  // Nearest Neighbor Optimization Algorithm
  let optimizedRoute = [];
  let currentPos = startLocation;
  let remaining = [...selectedShipments];

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let minDistance = getDistance(currentPos, remaining[0].destination);

    for (let i = 1; i < remaining.length; i++) {
      let dist = getDistance(currentPos, remaining[i].destination);
      if (dist < minDistance) {
        minDistance = dist;
        nearestIndex = i;
      }
    }

    const nextStop = remaining.splice(nearestIndex, 1)[0];
    optimizedRoute.push({
      ...nextStop,
      estimatedLegDistance: minDistance.toFixed(1),
      estimatedTravelTime: Math.round(minDistance * 2) // mock minutes
    });
    currentPos = nextStop.destination;
  }

  const totalMiles = optimizedRoute.reduce((sum, stop) => sum + parseFloat(stop.estimatedLegDistance), 0);
  const totalTime = optimizedRoute.reduce((sum, stop) => sum + stop.estimatedTravelTime, 0);

  res.json({
    route: optimizedRoute,
    summary: {
      totalStops: optimizedRoute.length,
      estimatedTotalMiles: totalMiles.toFixed(1),
      estimatedTotalDriveTime: `${Math.floor(totalTime / 60)}h ${totalTime % 60}m`,
      optimizedOrder: optimizedRoute.map(s => s.id)
    }
  });
});

app.put('/api/admin/shipments/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { driverName, status, dispatchDate, notes, deliveryPhotos } = req.body;
  const db = getDb();
  const shipment = db.shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment record not found' });

  if (driverName !== undefined) shipment.driverName = driverName;
  if (dispatchDate !== undefined) shipment.dispatchDate = dispatchDate;
  if (notes !== undefined) shipment.notes = notes;
  if (Array.isArray(deliveryPhotos)) shipment.deliveryPhotos = deliveryPhotos;

  let generatedInvoice = null;

  if (status) {
    const previousStatus = shipment.status || '';
    shipment.status = status;

    // When shipment status is set to In Route -> Order status automatically becomes 'Out for Delivery'
    if (status.toLowerCase() === 'in route' || status.toLowerCase() === 'in-route') {
      if (shipment.orderId) {
        const order = db.orders.find(o => o.id === shipment.orderId);
        if (order) {
          order.status = 'Out for Delivery';
          console.log(`Order ${order.id} status updated to 'Out for Delivery' as shipment ${shipment.id} is In Route.`);
        }
      }
    }

    // When shipment is marked as Delivered:
    if (status.toLowerCase() === 'delivered' && previousStatus.toLowerCase() !== 'delivered') {
      // 1. Update associated order status
      if (shipment.orderId) {
        const order = db.orders.find(o => o.id === shipment.orderId);
        if (order) {
          order.status = 'Delivered';

          // 2. Auto-generate invoice if not already present
          if (!db.invoices) db.invoices = [];
          const existingInvoice = db.invoices.find(inv => inv.orderId === order.id);

          if (!existingInvoice) {
            generatedInvoice = {
              id: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
              orderId: order.id,
              customerId: order.customerId,
              customerName: order.customerName,
              customerCompany: order.customerCompany || 'Direct Client',
              amount: order.totalAmount,
              subtotal: order.subtotal,
              deliveryFee: order.deliveryFee,
              tax: order.tax,
              status: 'Unpaid',
              createdAt: new Date().toISOString().split('T')[0]
            };
            db.invoices.unshift(generatedInvoice);
            console.log(`Auto-generated invoice ${generatedInvoice.id} for delivered order ${order.id}`);
          }
        }
      }
    }
  }

  await saveDb(db);
  res.json({
    message: 'Shipment updated successfully',
    shipment: sanitizeRecord(shipment),
    invoiceCreated: generatedInvoice ? sanitizeRecord(generatedInvoice) : null
  });
});

app.post('/api/admin/shipments/:id/photos', authenticateToken, requireAdmin, upload.single('photo'), async (req, res) => {
  const db = getDb();
  const shipment = db.shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment record not found' });

  if (!req.file) return res.status(400).json({ error: 'No photo file provided' });

  let photoUrl = '';
  if (supabase) {
    try {
      const fileExt = path.extname(req.file.originalname) || '.jpg';
      const fileName = `delivery-proof-${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (!error) {
        const { data: publicUrlData } = supabase.storage
          .from('product-images')
          .getPublicUrl(fileName);
        photoUrl = publicUrlData.publicUrl;
      }
    } catch (e) {
      console.error('Supabase delivery photo upload error:', e.message);
    }
  }

  if (!photoUrl) {
    photoUrl = '/assets/panel.png';
  }

  if (!shipment.deliveryPhotos) shipment.deliveryPhotos = [];
  shipment.deliveryPhotos.push(photoUrl);

  await saveDb(db);
  res.json({ success: true, photoUrl, shipment: sanitizeRecord(shipment) });
});

app.delete('/api/admin/shipments/:id', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db.shipments) db.shipments = [];
  const index = db.shipments.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Shipment record not found' });

  const deletedId = req.params.id;
  db.shipments.splice(index, 1);

  if (supabase) {
    try {
      await supabase.from('shipments').delete().eq('id', deletedId);
      console.log(`Deleted shipment ${deletedId} from Supabase.`);
    } catch (e) {
      console.error('Error deleting shipment from Supabase:', e.message);
    }
  }

  await saveDb(db);
  res.json({ success: true, message: 'Shipment record deleted successfully' });
});

// --- ADMIN CUSTOMERS, INVOICES, SALES & SHIPMENTS ENDPOINTS ---

app.get('/api/admin/customers', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const customers = db.users.filter(u => u.role === 'customer').map(u => {
    const cust = sanitizeRecord(u);
    if (cust.jobsites && Array.isArray(cust.jobsites)) {
      cust.jobsites = cust.jobsites.map(j => {
        const activeRentals = (db.rentals || []).filter(r =>
          r.customerId === u.id &&
          r.status !== 'Returned' &&
          (r.jobsiteAddress?.toLowerCase().includes((j.address || '').toLowerCase()) || r.jobsiteAddress?.toLowerCase().includes((j.name || '').toLowerCase()))
        );
        return { ...j, activeRentals };
      });
    } else {
      cust.jobsites = [];
    }
    return cust;
  });
  res.json(customers);
});

app.post('/api/admin/customers', authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, company, phone, role, isTaxable, businessAddress, jobsites } = req.body;
  const db = getDb();
  const newUser = {
    id: `${(role || 'customer').startsWith('admin') ? 'admin' : 'cust'}-${Date.now()}`,
    name,
    email: email ? email.toLowerCase() : '',
    passwordHash: '$2a$10$w0BInG8mPZf5m6Xp0w2v8OqU0N1c5eQ2W2X2Y2Z2a2b2c2d2e2f2g', // default: password123
    role: role || 'customer',
    company: company || '',
    phone: phone || '',
    isTaxable: isTaxable !== undefined ? Boolean(isTaxable) : true,
    businessAddress: businessAddress || '',
    jobsites: Array.isArray(jobsites) ? jobsites : []
  };
  db.users.push(newUser);
  await saveDb(db);
  res.status(201).json({ success: true, user: sanitizeRecord(newUser) });
});

app.put('/api/admin/customers/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, company, phone, role, isTaxable, businessAddress, jobsites } = req.body;
  const db = getDb();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Customer not found' });

  if (name) user.name = name;
  if (email) user.email = email.toLowerCase();
  if (company !== undefined) user.company = company;
  if (phone !== undefined) user.phone = phone;
  if (role) user.role = role;
  if (isTaxable !== undefined) user.isTaxable = Boolean(isTaxable);
  if (businessAddress !== undefined) user.businessAddress = businessAddress;
  if (Array.isArray(jobsites)) user.jobsites = jobsites;

  await saveDb(db);
  res.json({ success: true, message: 'Customer updated', user: sanitizeRecord(user) });
});

// Manage Jobsites for a Customer
app.post('/api/admin/customers/:id/jobsites', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Customer not found' });

  if (!user.jobsites) user.jobsites = [];

  const newJobsite = {
    id: `site-${Date.now()}`,
    name: req.body.name || 'Jobsite',
    address: req.body.address || '',
    contactName: req.body.contactName || '',
    contactPhone: req.body.contactPhone || '',
    specialInstructions: req.body.specialInstructions || '',
    deliveryDistanceMiles: parseFloat(req.body.deliveryDistanceMiles) || 0
  };

  user.jobsites.push(newJobsite);
  await saveDb(db);
  res.status(201).json({ success: true, jobsite: newJobsite, user: sanitizeRecord(user) });
});

app.put('/api/admin/customers/:id/jobsites/:jobsiteId', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user || !user.jobsites) return res.status(404).json({ error: 'Customer or jobsites not found' });

  const jobsite = user.jobsites.find(j => j.id === req.params.jobsiteId);
  if (!jobsite) return res.status(404).json({ error: 'Jobsite not found' });

  if (req.body.name) jobsite.name = req.body.name;
  if (req.body.address !== undefined) jobsite.address = req.body.address;
  if (req.body.contactName !== undefined) jobsite.contactName = req.body.contactName;
  if (req.body.contactPhone !== undefined) jobsite.contactPhone = req.body.contactPhone;
  if (req.body.specialInstructions !== undefined) jobsite.specialInstructions = req.body.specialInstructions;
  if (req.body.deliveryDistanceMiles !== undefined) jobsite.deliveryDistanceMiles = parseFloat(req.body.deliveryDistanceMiles) || 0;

  await saveDb(db);
  res.json({ success: true, jobsite, user: sanitizeRecord(user) });
});

app.delete('/api/admin/customers/:id/jobsites/:jobsiteId', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user || !user.jobsites) return res.status(404).json({ error: 'Customer or jobsites not found' });

  user.jobsites = user.jobsites.filter(j => j.id !== req.params.jobsiteId);
  await saveDb(db);
  res.json({ success: true, message: 'Jobsite removed', user: sanitizeRecord(user) });
});

app.delete('/api/admin/customers/:id', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const index = db.users.findIndex(u => u.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Customer not found' });

  const deletedId = req.params.id;
  db.users.splice(index, 1);

  if (supabase) {
    try {
      await supabase.from('users').delete().eq('id', deletedId);
      console.log(`Deleted user ${deletedId} from Supabase.`);
    } catch (e) {
      console.error('Error deleting user from Supabase:', e.message);
    }
  }

  await saveDb(db);
  res.json({ success: true, message: 'Customer deleted successfully' });
});

app.post('/api/admin/sales', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const newOrder = {
    id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    ...req.body,
    createdAt: new Date().toISOString()
  };
  db.orders.unshift(newOrder);
  await saveDb(db);
  res.status(201).json({ success: true, order: sanitizeRecord(newOrder) });
});

app.put('/api/admin/rentals/:id/extend', authenticateToken, requireAdmin, async (req, res) => {
  const { endDate } = req.body;
  const db = getDb();
  const rental = db.rentals.find(r => r.id === req.params.id);
  if (!rental) return res.status(404).json({ error: 'Rental not found' });
  rental.endDate = endDate;
  await saveDb(db);
  res.json({ success: true, rental: sanitizeRecord(rental) });
});

app.post('/api/admin/rentals/:id/invoice', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const rental = db.rentals.find(r => r.id === req.params.id);
  if (!rental) return res.status(404).json({ error: 'Active rental agreement not found' });

  if (!db.invoices) db.invoices = [];
  const existingInvoices = db.invoices.filter(inv => inv.orderId === rental.orderId || inv.customerName === rental.customerName);

  const monthNum = existingInvoices.length + 1;

  // Calculate next billing date by adding monthNum - 1 months to startDate
  let billingDate = rental.startDate || new Date().toISOString().split('T')[0];
  try {
    const startD = new Date(billingDate);
    startD.setMonth(startD.getMonth() + (monthNum - 1));
    billingDate = startD.toISOString().split('T')[0];
  } catch (e) {
    billingDate = new Date().toISOString().split('T')[0];
  }

  const tax = rental.isTaxable === false ? 0 : Math.round((rental.monthlyRateTotal || 0) * 0.08 * 100) / 100;
  const deliveryFee = monthNum === 1 ? (rental.deliveryFee || 0) : 0;
  const totalAmount = (rental.monthlyRateTotal || 0) + deliveryFee + tax;

  const newInvoice = {
    id: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
    orderId: rental.orderId || `RNT-${rental.id}`,
    customerId: rental.customerId,
    customerName: rental.customerName,
    customerCompany: rental.customerCompany || 'Direct Client',
    amount: totalAmount,
    subtotal: rental.monthlyRateTotal || 0,
    deliveryFee,
    tax,
    status: 'Unpaid',
    createdAt: billingDate,
    description: `Month ${monthNum} Recurring Rental Billing (${billingDate})`
  };

  db.invoices.unshift(newInvoice);
  await saveDb(db);

  res.status(201).json({
    success: true,
    message: `Month ${monthNum} invoice generated for ${rental.customerName}`,
    invoice: sanitizeRecord(newInvoice)
  });
});

app.post('/api/admin/shipments/pickup', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const newShipment = {
    id: `SHP-${Math.floor(1000 + Math.random() * 9000)}`,
    type: 'Pickup',
    ...req.body,
    status: 'scheduled'
  };
  db.shipments.unshift(newShipment);
  await saveDb(db);
  res.status(201).json({ success: true, shipment: sanitizeRecord(newShipment) });
});

app.get('/api/admin/invoices', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  res.json((db.invoices || []).map(sanitizeRecord));
});

app.post('/api/admin/invoices', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db.invoices) db.invoices = [];
  const newInvoice = {
    id: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
    ...req.body,
    createdAt: new Date().toISOString().split('T')[0]
  };
  db.invoices.unshift(newInvoice);
  await saveDb(db);
  res.status(201).json({ success: true, invoice: sanitizeRecord(newInvoice) });
});

app.put('/api/admin/invoices/:id/payment', authenticateToken, requireAdmin, async (req, res) => {
  const { status, paymentMethod } = req.body;
  const db = getDb();
  if (!db.invoices) db.invoices = [];
  const invoice = db.invoices.find(inv => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  if (status) invoice.status = status;
  if (paymentMethod) invoice.paymentMethod = paymentMethod;

  await saveDb(db);
  res.json({ success: true, message: 'Invoice payment updated', invoice: sanitizeRecord(invoice) });
});

app.delete('/api/admin/invoices/:id', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db.invoices) db.invoices = [];
  const index = db.invoices.findIndex(inv => inv.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Invoice not found' });

  const deletedId = req.params.id;
  db.invoices.splice(index, 1);

  if (supabase) {
    try {
      await supabase.from('invoices').delete().eq('id', deletedId);
      console.log(`Deleted invoice ${deletedId} from Supabase.`);
    } catch (e) {
      console.error('Error deleting invoice from Supabase:', e.message);
    }
  }

  await saveDb(db);
  res.json({ success: true, message: 'Invoice deleted successfully' });
});

// --- ADMIN PRODUCT MANAGEMENT ---

app.get('/api/admin/products', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  res.json(db.products.map(sanitizeRecord));
});

app.post('/api/admin/products', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const newProduct = {
    id: req.body.id || `prod-${Date.now()}`,
    name: req.body.name,
    category: req.body.category || 'sales',
    type: req.body.type || 'panel',
    salePrice: parseFloat(req.body.salePrice) || 0,
    rentalPriceMonthly: parseFloat(req.body.rentalPriceMonthly) || 0,
    inStock: parseInt(req.body.inStock) || 0,
    rentedCount: parseInt(req.body.rentedCount) || 0,
    description: req.body.description || '',
    image: req.body.image || '/assets/panel.png',
    specs: req.body.specs || '',
    suspended: req.body.suspended || false,
    isRental: req.body.isRental !== undefined ? Boolean(req.body.isRental) : true,
    isPurchase: req.body.isPurchase !== undefined ? Boolean(req.body.isPurchase) : true
  };
  db.products.push(newProduct);
  await saveDb(db);
  res.status(201).json({ success: true, product: sanitizeRecord(newProduct) });
});

app.put('/api/admin/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const index = db.products.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Product not found' });

    const updatedProduct = {
      ...db.products[index],
      ...req.body,
      // Ensure numeric types
      salePrice: req.body.salePrice !== undefined ? parseFloat(req.body.salePrice) : db.products[index].salePrice,
      rentalPriceMonthly: req.body.rentalPriceMonthly !== undefined ? parseFloat(req.body.rentalPriceMonthly) : db.products[index].rentalPriceMonthly,
      inStock: req.body.inStock !== undefined ? parseInt(req.body.inStock) : db.products[index].inStock,
      rentedCount: req.body.rentedCount !== undefined ? parseInt(req.body.rentedCount) : db.products[index].rentedCount,
      isRental: req.body.isRental !== undefined ? Boolean(req.body.isRental) : (db.products[index].isRental !== undefined ? db.products[index].isRental : true),
      isPurchase: req.body.isPurchase !== undefined ? Boolean(req.body.isPurchase) : (db.products[index].isPurchase !== undefined ? db.products[index].isPurchase : true)
    };

    db.products[index] = updatedProduct;
    await saveDb(db);
    res.json({ success: true, product: sanitizeRecord(updatedProduct) });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product in database' });
  }
});

app.delete('/api/admin/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const index = db.products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Product not found' });

  const deletedId = req.params.id;
  db.products.splice(index, 1);

  if (supabase) {
    try {
      await supabase.from('products').delete().eq('id', deletedId);
      console.log(`Deleted product ${deletedId} permanently from Supabase.`);
    } catch (e) {
      console.error('Error deleting product from Supabase:', e.message);
    }
  }

  await saveDb(db);
  res.json({ success: true, message: 'Product deleted permanently' });
});

app.post('/api/admin/products/upload', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase client not initialized' });
  }

  try {
    const fileExt = path.extname(req.file.originalname);
    const fileName = `product-${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      return res.status(500).json({ error: 'Failed to upload image to Supabase Storage' });
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(fileName);

    const imageUrl = publicUrlData.publicUrl;
    res.json({ success: true, imageUrl });
  } catch (err) {
    console.error('Unexpected upload error:', err);
    res.status(500).json({ error: 'Unexpected error during upload' });
  }
});

// Start server after database hydration
initDbFromSupabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Secure-A-Fence server running on http://localhost:${PORT}`);
  });
});
