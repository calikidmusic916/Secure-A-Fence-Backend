-- 1. Users Table
create table if not exists public.users (
  id text primary key,
  name text not null,
  email text unique not null,
  "passwordHash" text not null,
  role text not null default 'customer',
  company text,
  phone text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Products Table
create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null,
  type text not null,
  "salePrice" numeric not null default 0,
  "rentalPriceMonthly" numeric not null default 0,
  "inStock" integer not null default 0,
  "rentedCount" integer not null default 0,
  description text,
  image text,
  specs text
);

-- 3. Orders Table
create table if not exists public.orders (
  id text primary key,
  "customerId" text not null,
  "customerName" text not null,
  "customerCompany" text,
  "customerEmail" text not null,
  "customerPhone" text,
  "orderType" text not null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  "deliveryFee" numeric not null default 0,
  tax numeric not null default 0,
  "totalAmount" numeric not null default 0,
  status text not null default 'Processing',
  "deliveryAddress" text,
  "jobsiteContact" text,
  "deliveryDate" text,
  "createdAt" text,
  "paymentStatus" text not null default 'Unpaid',
  "paymentMethod" text not null default 'None'
);

-- 4. Rentals Table
create table if not exists public.rentals (
  id text primary key,
  "orderId" text not null,
  "customerId" text not null,
  "customerName" text not null,
  "customerCompany" text,
  "customerEmail" text not null,
  "customerPhone" text,
  "jobsiteAddress" text,
  "jobsiteContact" text,
  "startDate" text,
  "endDate" text,
  "monthlyRateTotal" numeric not null default 0,
  status text not null default 'Active',
  items jsonb not null default '[]'::jsonb,
  notes text
);

-- 5. Shipments Table
create table if not exists public.shipments (
  id text primary key,
  "orderId" text not null,
  type text not null,
  "driverName" text,
  "dispatchDate" text,
  status text not null default 'Pending Dispatch',
  destination text,
  notes text
);

-- 6. Invoices Table
create table if not exists public.invoices (
  id text primary key,
  "orderId" text not null,
  "customerName" text not null,
  amount numeric not null default 0,
  status text not null default 'Unpaid',
  "createdAt" text
);

-- 7. Add missing columns to existing orders table (if previously created)
alter table public.orders add column if not exists "paymentStatus" text not null default 'Unpaid';
alter table public.orders add column if not exists "paymentMethod" text not null default 'None';

-- 8. Add suspended column to products table
alter table public.products add column if not exists suspended boolean not null default false;
