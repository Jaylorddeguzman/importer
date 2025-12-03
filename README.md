# OSM Importer Service

A standalone background service that continuously imports establishments from OpenStreetMap into MongoDB. Designed to run on a separate server instance (like Render free tier) to avoid resource conflicts with the main application.

## Features

✅ **Standalone Service** - Runs independently from the main application
✅ **Self-Pinging** - Keeps itself awake on Render free tier (no sleeping)
✅ **Continuous Import** - Runs 24/7 importing establishments
✅ **Smart Rate Limiting** - Respects OpenStreetMap API limits
✅ **Duplicate Detection** - Won't re-import existing establishments
✅ **Health Monitoring** - Built-in health and stats endpoints
✅ **Auto-Recovery** - Continues running even if errors occur
✅ **Progress Tracking** - Real-time logging and statistics

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:
```env
# Your MongoDB connection string (same as main app)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/localproductfinder

# Your Render service URL (set after deployment)
RENDER_EXTERNAL_URL=https://your-importer-service.onrender.com

# Optional settings
IMPORT_MODE=continuous
IMPORT_DELAY=3000
```

### 3. Run Locally

```bash
npm start
```

Or for development:
```bash
npm run dev
```

## Deployment to Render

### Step 1: Create New Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" → "Web Service"
3. Connect your repository
4. Configure:
   - **Name**: `osm-importer-service` (or your preferred name)
   - **Root Directory**: `osm-importer-service`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

### Step 2: Set Environment Variables

In Render dashboard, add these environment variables:

- `MONGODB_URI`: Your MongoDB connection string
- `RENDER_EXTERNAL_URL`: Your Render service URL (e.g., `https://osm-importer-service.onrender.com`)
- `NODE_ENV`: `production`

### Step 3: Deploy

Click "Create Web Service" and wait for deployment to complete.

### Step 4: Verify

Visit these endpoints to verify it's working:

- `https://your-service.onrender.com/` - Service info and stats
- `https://your-service.onrender.com/health` - Health check
- `https://your-service.onrender.com/stats` - Detailed statistics

## Monitoring

### Health Check Endpoint

```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "isImporting": true,
  "totalImported": 1250
}
```

### Stats Endpoint

```bash
GET /stats
```

Response:
```json
{
  "service": "OSM Importer Service",
  "state": {
    "isRunning": true,
    "mode": "continuous",
    "currentProvince": "Metro Manila",
    "currentType": "restaurant"
  },
  "progress": {
    "totalImported": 1250,
    "cycleCount": 2,
    "errors": 3,
    "uptime": 3600,
    "lastImportTime": "2025-12-03T10:30:45.123Z"
  },
  "keepAlive": {
    "enabled": true,
    "pings": 15,
    "interval": "14 minutes"
  }
}
```

## How It Works

1. **Continuous Import**: Cycles through all provinces and establishment types
2. **Smart Scheduling**: Pauses between requests to respect API limits
3. **Duplicate Prevention**: Checks existing data before inserting
4. **Self-Pinging**: Pings itself every 14 minutes to prevent Render from sleeping
5. **Health Monitoring**: Provides endpoints for monitoring service status

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | Yes | - | MongoDB connection string |
| `RENDER_EXTERNAL_URL` | Yes* | - | Service URL for self-ping (*required in production) |
| `PORT` | No | 3001 | Server port (Render sets automatically) |
| `IMPORT_MODE` | No | continuous | Import mode (currently only continuous) |
| `IMPORT_DELAY` | No | 3000 | Delay between API requests (ms) |
| `NODE_ENV` | No | development | Environment (production/development) |

### Coverage

**Provinces**: 19 locations including Metro Manila, Cebu, Davao, and major cities
**Establishment Types**: 40+ types including restaurants, hospitals, schools, banks, etc.
**Total Combinations**: 760+ location-type pairs

The importer continuously cycles through all combinations, importing new establishments 24/7.

## Troubleshooting

### Service Keeps Sleeping

Make sure `RENDER_EXTERNAL_URL` is set correctly in your environment variables. Check logs for keep-alive ping messages.

### No Data Being Imported

1. Verify MongoDB connection string is correct
2. Check if MongoDB has sufficient storage
3. Look for rate limit messages in logs
4. Verify network connectivity to OpenStreetMap API

### High Error Count

- OpenStreetMap API might be rate-limiting
- Network issues with OSM or MongoDB
- Check logs for specific error messages

### MongoDB Connection Failed

- Verify connection string format
- Check MongoDB Atlas whitelist (allow all IPs: `0.0.0.0/0`)
- Ensure MongoDB cluster is running

## Logs

View real-time logs in Render dashboard or using Render CLI:

```bash
render logs osm-importer-service
```

Logs include:
- Import progress
- Establishments added
- Errors and warnings
- Keep-alive pings
- Health check results

## Resource Usage

**Memory**: ~100-150MB
**CPU**: Minimal (most time spent waiting)
**Network**: ~5-10 API calls per minute
**Storage**: MongoDB only (no local storage needed)

Perfect for Render free tier! 🎉

## Stopping the Service

On Render:
1. Go to service dashboard
2. Click "Suspend" to pause the service
3. Click "Resume" to restart

Locally:
- Press `Ctrl+C` in terminal

## Architecture

```
┌─────────────────────────────────────┐
│   OSM Importer Service (Port 3001)  │
│                                     │
│   ┌─────────────────────────────┐  │
│   │   Express Health Server     │  │
│   │   /health /stats /          │  │
│   └─────────────────────────────┘  │
│                                     │
│   ┌─────────────────────────────┐  │
│   │   Keep-Alive Service        │  │
│   │   Self-ping every 14min     │  │
│   └─────────────────────────────┘  │
│                                     │
│   ┌─────────────────────────────┐  │
│   │   Import Loop               │  │
│   │   Province → Type → Import  │  │
│   └─────────────────────────────┘  │
│                                     │
└──────────┬──────────────────────────┘
           │
           ├──→ OpenStreetMap API
           │
           └──→ MongoDB (shared with main app)
```

## Contributing

This is a simple, focused service. Feel free to:
- Adjust import delays
- Add more provinces/types
- Modify logging
- Enhance error handling

## License

MIT

---

**Made for Local Product Finder** 🗺️
Runs independently on Render free tier without sleeping! ⚡
