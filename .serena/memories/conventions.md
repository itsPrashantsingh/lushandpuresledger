# Conventions (imitate when adding features)

## General
- No TypeScript — plain `.js`/`.jsx`. No prop-types. 2-space indent, single quotes, no semicolons (frontend). Backend also mostly no semicolons.
- Keep the "two data paths" split: new plain CRUD → Supabase client from the page; new secret/cross-user logic → Express route.

## Frontend
- **Pages** (`src/pages/*.jsx`) are big self-contained default-export function components. They fetch their own data with the `supabase` client in `useEffect`, hold local `useState`, and render inline JSX + Tailwind. There is no global store/react-query — data fetching is per-page.
- Shared logic lives in `src/lib/*` — reuse it, don't inline: `utils.js` (formatting/date/status helpers), `bills.js` (bill creation, Razorpay orchestration, paid-amount lookups), `messages.js` + `whatsapp.js` (WhatsApp templates/links), `pdf.js` (jsPDF bills), `gst.js` (`calculateGst`, `amountInWords`), `import-export.js` + `export-data.js` (xlsx), `api.js` (`apiGet`/`apiPost` with auth header), `constants.js` (settings + `BACKEND_URL`).
- **Backend calls** go through `apiGet`/`apiPost` in `src/lib/api.js` — they attach `Authorization: Bearer <supabase JWT>`. Don't hand-roll axios+auth.
- Currency/qty: always `formatCurrency()` / `formatQty()`; PDF variants `formatAmountPdf`/`formatQtyPdf` (jsPDF can't render ₹ → use "Rs.").
- Reusable UI in `src/components/`: `Navbar`, `ProtectedRoute`, `Toast`, `StatCard`, `BillCard`, `CustomerCard`, `CattleCard`, `QtyControl`, `LoadingOverlay`, `WhatsAppSendQueue`. Adding a nav item = add to `links` array in `Navbar.jsx` AND a `<Route>` in `App.jsx`.
- Tailwind brand color = green-600/700. Status pills via `statusBadgeClass()` (green=paid, amber=partial, red=unpaid).
- Custom per-customer/per-cattle fields stored as `custom_fields` jsonb; preserve them on edit (a past bug stripped them on CustomerDetail save).

## Backend
- Each route file = an `express.Router()` exporting the router; mounted in `server.js`. Handlers are `async (req, res, next)` with `try/catch(next)`.
- Protected routers do `router.use(requireUser)` (from `lib/auth.js`) → sets `req.user = { id, email }`. Exception: `/api/razorpay/confirm-payment` is public (customer post-payment); Razorpay signature verifies instead.
- Server-side writes with side effects should call `logActivity(req.user, action, entityType, { entityId, entityDate, details })` (`lib/activity-log.js`).
- Reuse `lib/razorpay-sync.js` for anything Razorpay; reuse `lib/mark-paid.js` (`markBillPaidFromRazorpay`) as the single idempotent path to mark a bill paid + insert a payment row.
