# SmartShodhai — স্মার্ট সহাই

**AI-powered inventory and distribution management for Bangladeshi FMCG distributors.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-smartshodhai--v2.vercel.app-blue?style=flat-square)](https://smartshodhai-v2.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Database%20%26%20Auth-green?style=flat-square&logo=supabase)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/)

---

## Overview

SmartShodhai is a multi-tenant SaaS web application built for small-to-medium FMCG distributors in Bangladesh. It replaces paper-based khata systems and fragmented spreadsheets with a single, AI-assisted platform that handles inventory, trade credit (baki), sales tracking, and business intelligence — in both English and Bengali.

---

## Live Demo

**URL:** [smartshodhai-v2.vercel.app](https://smartshodhai-v2.vercel.app)

> Register a new account to explore the full app. Each account is fully isolated (multi-tenant RLS).

---

## Key Features

### Dashboard
- Daily sales, total baki, and low stock alerts at a glance
- 7-day sales trend chart
- Top products this week
- Low stock alerts table with reorder levels

### Inventory Management
- Add, edit, and track products with stock quantity, unit, selling price, and reorder level
- Category filtering and product search
- Scan Barcode shortcut for quick stock updates

### Baki / Trade Credit Tracker
- Record and manage outstanding baki per customer
- Baki aging chart to identify overdue accounts
- Send payment reminders
- Track partial payments and mark debts as settled

### Sales Log
- Record cash sales and baki sales in one flow
- Filter by date range and product
- Export to CSV for offline reporting

### Scan Module
- **Barcode Scan** — scan product barcode, then add stock or record sale
- **Scan Ledger** — upload khata photo, OCR extracts rows, adds to inventory
- **Product Scan** — scan barcode, adjust quantity with +/− selector

### AI Assistant (Bilingual)
- Powered by Google Gemini API
- Ask business questions in English or Bengali
- Quick prompts: "আমার বাকি কত?", "আজকের বিক্রি কত?", "কম স্টক কোনগুলো?"
- Contextual answers from your actual business data

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend / Database | Supabase (PostgreSQL + Row Level Security) |
| Authentication | Supabase Auth |
| AI Integration | Google Gemini API |
| Charts | Recharts (SSR-safe dynamic import) |
| Deployment | Vercel |
| Package Manager | pnpm |

---

## Security

- Row Level Security (RLS) enforced on all 4 Supabase tables: `products`, `sales_log`, `baki`, `baki_payments`
- All queries scoped to `auth.uid()` — tenants cannot access each other's data
- Middleware auth guard prevents unauthenticated access to protected routes
- Environment variables managed via Vercel for production secrets

---

## Local Setup

```bash
# Clone the repo
git clone https://github.com/raisul-islam-rehan/smartshodhai-v2.git
cd smartshodhai-v2/SmartShodhai

# Install dependencies
pnpm install

# Add environment variables
cp .env.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, GEMINI_API_KEY

# Run locally
pnpm dev
```

---

## Project Background

SmartShodhai was built to solve a real problem observed firsthand during 3 years in FMCG sales and distribution in Bangladesh — distributors rely on handwritten khata books and informal phone calls to track stock and baki, leading to cash flow leakage and inventory blind spots.

This is v2, a full production rebuild of a v1 prototype built in Google AI Studio. v2 adds multi-tenancy, RLS security, a full Next.js frontend, and a bilingual AI assistant.

---

## Author

**Raisul Islam Rehan**
BBA, Business Analytics — AIUB, Dhaka
AI Automation Agency — Solo Founder

- Portfolio: [raycfu.com](https://raycfu.com)
- GitHub: [@raisul-islam-rehan](https://github.com/raisul-islam-rehan)
- Email: raisulrehan2.0@gmail.com

---

*Built with Next.js · Supabase · Gemini API · Tailwind CSS · Vercel*
