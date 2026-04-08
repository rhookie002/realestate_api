# Property Search App

Real Estate Map Search — TypeScript + Express

## Local Development

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Deploy to Railway

### Option A — Railway CLI (fastest)
```bash
npm install -g @railway/cli
railway login
railway init        # create a new project
railway up          # deploy
railway open        # open in browser
```

### Option B — GitHub (recommended for ongoing use)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repo — Railway auto-detects `railway.toml` and deploys

No environment variables are needed. The app serves the static HTML which calls the webhook URLs already baked into the frontend.

## Project Structure

```
property-search/
├── src/
│   └── index.ts        # Express server
├── public/
│   └── index.html      # The property search app
├── package.json
├── tsconfig.json
└── railway.toml        # Railway build/start config
```
