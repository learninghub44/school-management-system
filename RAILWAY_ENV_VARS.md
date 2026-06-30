# Railway Environment Variables

Set these in your Railway project → Variables tab.

## Required — set manually in Railway dashboard

| Variable | Value / Notes |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Generate a strong random secret |
| `JWT_EXPIRES` | `10h` |
| `DATABASE_URL` | Your PostgreSQL provider's connection/pooler URI |
| `ALLOWED_ORIGINS` | Your Railway domain e.g. `https://school-management-system-production.up.railway.app` — add custom domain here too once set |
| `GROQ_API_KEY` | Your Groq API key |
| `GROQ_MODEL` | `openai/gpt-oss-20b` |
| `PAYSTACK_SECRET_KEY` | Your Paystack live secret key |
| `PAYSTACK_CALLBACK_URL` | `https://YOUR-RAILWAY-DOMAIN.up.railway.app/subscription.html` |
| `PESAPAL_BASE_URL` | `https://pay.pesapal.com/v3/api` |
| `PESAPAL_CONSUMER_KEY` | Your Pesapal consumer key |
| `PESAPAL_CONSUMER_SECRET` | Your Pesapal consumer secret |
| `PESAPAL_CALLBACK_URL` | `https://YOUR-RAILWAY-DOMAIN.up.railway.app/subscription.html` |
| `PESAPAL_IPN_URL` | `https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/subscriptions/ipn` |
| `PESAPAL_IPN_ID` | Your Pesapal IPN ID (re-register IPN in Pesapal dashboard with new URL) |
| `PLATFORM_SUPPORT_EMAIL` | `support@cbcerp.co.ke` |

## Custom Domain (after deploy)
1. Railway dashboard → your project → Settings → Networking → Custom Domain
2. Add your domain and point DNS CNAME to the Railway-provided value
3. Update `ALLOWED_ORIGINS`, `PAYSTACK_CALLBACK_URL`, `PESAPAL_CALLBACK_URL`, and `PESAPAL_IPN_URL` to use your custom domain
4. Re-register the IPN URL in your Pesapal dashboard

## Notes
- Frontend is served by the Express backend — no separate frontend deployment needed.
- `DATABASE_URL`: use the pooled connection string from your PostgreSQL provider, not the direct connection.
