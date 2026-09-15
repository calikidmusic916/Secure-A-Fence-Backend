-- 1. Users Table
create table if not exists public.users (
  id text primary key,
  name text not null,
  email text unique not null,
  "passwordHash" text not null,
  role text not null default 'customer',
  company text,
  phone text,
  "isTaxable" boolean not null default true,
  "businessAddress" text,
  jobsites jsonb not null default '[]'::jsonb,
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
  specs text,
  unit text default 'unit',
  suspended boolean not null default false,
  "isRental" boolean not null default true,
  "isPurchase" boolean not null default true
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
  notes text,
  eta text,
  "deliveryPhotos" jsonb default '[]'::jsonb,
  "deliveredItems" jsonb default '[]'::jsonb
);

-- 6. Invoices Table
create table if not exists public.invoices (
  id text primary key,
  "orderId" text not null,
  "customerName" text not null,
  amount numeric not null default 0,
  subtotal numeric default 0,
  "deliveryFee" numeric default 0,
  tax numeric default 0,
  status text not null default 'Unpaid',
  "createdAt" text
);

-- 7. Schema Alterations (Safely Add Columns to Pre-existing Supabase Tables)
alter table public.users add column if not exists "isTaxable" boolean default true;
alter table public.users add column if not exists "businessAddress" text;
alter table public.users add column if not exists jobsites jsonb default '[]'::jsonb;

alter table public.products add column if not exists unit text default 'unit';
alter table public.products add column if not exists suspended boolean default false;
alter table public.products add column if not exists "isRental" boolean default true;
alter table public.products add column if not exists "isPurchase" boolean default true;

alter table public.orders add column if not exists "paymentStatus" text default 'Unpaid';
alter table public.orders add column if not exists "paymentMethod" text default 'None';

alter table public.shipments add column if not exists eta text;
alter table public.shipments add column if not exists "deliveryPhotos" jsonb default '[]'::jsonb;
alter table public.shipments add column if not exists "deliveredItems" jsonb default '[]'::jsonb;

alter table public.invoices add column if not exists subtotal numeric default 0;
alter table public.invoices add column if not exists "deliveryFee" numeric default 0;
alter table public.invoices add column if not exists tax numeric default 0;
