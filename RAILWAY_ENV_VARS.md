# Railway Environment Variables

Set these in your Railway project → Variables tab.

## Required — set manually in Railway dashboard

| Variable | Value / Notes |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Generate a strong random secret |
| `JWT_EXPIRES` | `10h` |
| `DATABASE_URL` | Your Supabase PostgreSQL connection string (Transaction pooler recommended) |
| `ALLOWED_ORIGINS` | Your Vercel frontend URL e.g. `https://your-app.vercel.app,https://yourdomain.co.ke` |
| `GROQ_API_KEY` | Your Groq API key |
| `GROQ_MODEL` | `llama3-8b-8192` |
| `PAYSTACK_SECRET_KEY` | Your Paystack live secret key |
| `PAYSTACK_CALLBACK_URL` | `https://your-app.vercel.app/subscription.html` |
| `PESAPAL_BASE_URL` | `https://pay.pesapal.com/v3/api` |
| `PESAPAL_CONSUMER_KEY` | Your Pesapal consumer key |
| `PESAPAL_CONSUMER_SECRET` | Your Pesapal consumer secret |
| `PESAPAL_CALLBACK_URL` | `https://your-app.vercel.app/subscription.html` |
| `PESAPAL_IPN_URL` | `https://YOUR-RAILWAY-DOMAIN.railway.app/api/subscriptions/ipn` |
| `PESAPAL_IPN_ID` | Your Pesapal IPN ID |
| `PLATFORM_SUPPORT_EMAIL` | `support@cbcerp.co.ke` |

## Notes
- Replace `your-app.vercel.app` with your actual Vercel URL (or custom domain).
- Replace `YOUR-RAILWAY-DOMAIN.railway.app` with your actual Railway-generated domain.
- `DATABASE_URL` from Supabase: go to Project Settings → Database → Connection String → Transaction pooler (port 6543).
- After setting `PESAPAL_IPN_URL`, re-register the IPN in your Pesapal dashboard with the new Railway URL.
