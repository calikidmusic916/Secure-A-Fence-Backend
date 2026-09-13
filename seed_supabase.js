require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in your .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const DB_PATH = path.join(__dirname, 'data', 'db.json');

async function seed() {
  console.log('--- Starting Supabase Seeding ---');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`Error: Local database file not found at ${DB_PATH}`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

  const tables = ['users', 'products', 'orders', 'rentals', 'shipments', 'invoices'];

  for (const table of tables) {
    if (data[table] && data[table].length > 0) {
      console.log(`Uploading ${data[table].length} records to "${table}"...`);
      let payload = data[table];
      if (table === 'products') {
        payload = data.products.map(p => {
          const copy = { ...p };
          delete copy.isRental;
          delete copy.isPurchase;
          delete copy.unit;
          delete copy.suspended;
          return copy;
        });
      }
      const { error } = await supabase.from(table).upsert(payload);
      if (error) {
        console.error(`  Error uploading to ${table}:`, error.message);
      } else {
        console.log(`  Successfully uploaded to ${table}.`);
      }
    } else {
      console.log(`No records found for table "${table}". Skipping.`);
    }
  }

  console.log('--- Seeding Complete ---');
}

seed();
