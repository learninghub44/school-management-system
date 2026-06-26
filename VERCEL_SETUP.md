# Vercel Frontend Setup

## Deploy steps

1. Go to https://vercel.com/new → Import your GitHub repo (`learninghub44/school-management-system`)
2. Set **Root Directory** to `frontend`
3. Framework Preset: **Other** (it's static HTML)
4. Click Deploy

## After Railway is deployed

1. Copy your Railway backend URL e.g. `https://school-management-system-production.up.railway.app`
2. Edit `frontend/vercel.json` — replace `RAILWAY_BACKEND_URL` with your actual Railway domain:

```json
"destination": "https://school-management-system-production.up.railway.app/api/:path*"
```

3. Push the change → Vercel auto-redeploys.

## Environment Variables on Vercel

No env vars needed — the frontend is static HTML and all API calls go through the `/api` rewrite defined in `vercel.json`.

## Custom Domain

1. Vercel dashboard → your project → Settings → Domains
2. Add your domain (e.g. `app.cbcerp.co.ke`)
3. Point your DNS to Vercel's nameservers or add the CNAME they give you
4. Update `ALLOWED_ORIGINS` in Railway to include your custom domain
5. Update `PAYSTACK_CALLBACK_URL` and `PESAPAL_CALLBACK_URL` in Railway to your custom domain
