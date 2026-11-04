# DesignMind AI

Personal studio for textile, fashion and graphic designers: sourced trend research for 15 markets, a fabric database with honest specification labels, reference-to-concept design generation, colourways, repeat previews and design critique.

**Free to run.** Hosted on GitHub Pages, installs like an app on Windows, Mac, Android and iPhone, and needs no Node.js or server on your computer.

---

## Setup (ek dafa, ~10 minute)

### 1. Upload to GitHub
1. Make a free account at **github.com** (if you don't have one).
2. Top right **+** → **New repository** → name it `designmind-ai` → **Public** → **Create repository**.
3. On the new page click **uploading an existing file**.
4. Unzip `designmind-ai.zip` on your computer, open the folder, select **everything inside it** (including the `.github` folder) and drag it into the page. Click **Commit changes**.
   - Mac: press `Cmd + Shift + .` in Finder to see the hidden `.github` folder.
   - If `.github` does not upload, create the two workflow files by hand: **Add file → Create new file**, name `.github/workflows/update-brands.yml`, paste its content; same for `update-research.yml`.

### 2. Turn on the website
1. In the repository: **Settings → Pages**.
2. Under **Source** choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After about a minute your app is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. It republishes by itself whenever files change.

### 2b. Check the automatic jobs
Open **Actions**. On the left you should see **Update brand catalogues** and **Update trend research**. If they are missing, the hidden `.github` folder was not uploaded: create each file with **Add file → Create new file**, name it `.github/workflows/update-brands.yml` (and `.github/workflows/update-research.yml`) and paste the file's contents from the zip.

### 3. Free AI key (for concepts, briefs, critique, and weekly research)
1. Open **aistudio.google.com/apikey**, sign in with Google, **Create API key**, copy it.
2. **In the app:** Settings → Provider *Google Gemini* → paste key → **Save settings** → **Test AI**.
3. **For automatic research:** repository **Settings → Secrets and variables → Actions → New repository secret**, name `GEMINI_API_KEY`, paste the same key.

### 4. Install the app
- **Windows / Mac (Chrome or Edge):** open your app link → click **Install app** (top bar) or the install icon in the address bar.
- **Android (Chrome):** menu ⋮ → **Install app**.
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.

After that, open DesignMind from its own icon. It runs in its own window and works offline for trends, fabrics, colourways, repeats and projects.

---

## What works without AI or internet
Trend research (saved snapshot), fabric database and comparison, colourway extraction and recolouring (HEX + RGB, manual edit), repeat preview with seam check and PNG export, projects, favourites, reports and backups.

## "This model is currently experiencing high demand"
That message comes from Google when Gemini is overloaded. The app now handles it by itself: it waits and retries, then switches to another Gemini model. For an instant switch, add a free **Groq** key in **Settings → Backup AI** (console.groq.com/keys); the app uses it automatically whenever Gemini is busy.

## Search (text or picture)
The **Search** tab finds designs for anything you type (English or Roman Urdu, e.g. "girls floral frock", "paisley border print", "Eid sale poster"), or for a picture you add with **Picture** (or drag, or paste). With the free Gemini key, AI looks at your picture and writes the search for you; without it, the app searches by your words and the picture's colours. Results come from brand catalogues in the app, open design libraries (Openverse, Wikimedia, the Art Institute of Chicago and The Met museum, plus Pexels/Unsplash if you add keys) and AI-made original designs. Scroll down and more results load by themselves.

AI pictures use the free Pollinations service, which allows about one picture every 15 seconds without an account, so the app makes them one at a time (2 per search; press "Make 2 more AI designs" for more). For faster AI pictures, sign in free at auth.pollinations.ai and paste your token in Settings. Every picture has a **Download** button. Brand pictures are the brands' own designs: use them for research and inspiration, not to copy.

## Trend articles inside the app
Tap any trend card: the full article opens inside DesignMind (through the free r.jina.ai reader), with pictures, related trends, a **Design from this trend** button, and a link to that brand's designs in the app. If a site cannot be read, the verified research summary is shown instead.

## What needs the free AI key
Reference analysis and original concepts, research-based colourways, trend briefs, fabric Q&A, graphic design critique.

## Brands (in-app designs)
- **Brands** tab lists every brand A–Z (520 brands: 113 Pakistani, and 14–45 for every other market, including many print-led labels useful for textile designers). Choose **Kids / Women / Men / Home**, filter by market and type, or search a name, then tap a brand: its designs open inside the app with Girls / Boys / Baby filters, search, price sort and a large view.
- Catalogues are read by GitHub every **Wednesday**, and also automatically right after you upload a new `data/brands.json`. To run it yourself: **Actions → Update brand catalogues → Run workflow** (`all`, a market like `pakistan`, or one brand id like `bachaa-party`). Pakistani brands appear in about 30–40 minutes; the other countries follow within 2–5 hours. Each brand's full collection is read (every Kids, Women, Men and Home collection, up to 5,000 products), and in the app you can browse All designs, each section, and each collection.
- The reader tries, in order: the store's Shopify feed, its WooCommerce feed, then its product sitemap and product pages. If a listed web address is wrong, it searches for the brand's real site and fixes the address.
- The run log ends with a summary: how many brands have designs in the app, and which are "website only" (the site blocks automatic reading; large international chains usually do).
- **Add a brand:** Actions → Update brand catalogues → Run workflow → fill "Add a new brand" (website, name, market, kids/women/men).
- Images are not copied; they load from the brand's own site. Use them for research, not copying.

## Inspiration (for graphic designers)
- **Inspiration** tab: describe your idea, pick a category (billboards, magazine covers and layouts, posters, social media, print ads, packaging, logos, typography, flyers, book covers, shop signs, textile prints) and press **Show designs**.
- Images come from **Openverse** and **Wikimedia Commons** (free, openly licensed, no key). Add free **Pexels** or **Unsplash** keys in Settings for more photos. With the Gemini key, AI turns your idea into better search words. Optional AI concept sketches are labelled.
- Tick images and **Save as moodboard**, or open one and send it to **Graphic design critique** for ideas.
- Behance, Pinterest and Dribbble do not allow other apps to show their designs, so they are not included.

## Updating trend research
- Runs automatically **every Monday** on GitHub (free).
- To run now: **Actions → Update trend research → Run workflow** (choose `all` or one market).
- The script searches the web for free (DuckDuckGo), opens the pages, and asks the AI to extract trends **only from those pages**. A trend is kept only if it links to a page the script actually opened; publication dates come from the page itself; anything over 12 months old is marked historical; forecasts are kept separate.
- If searches come back empty (search sites sometimes block GitHub's computers), add a free **Tavily** key as secret `TAVILY_API_KEY` (tavily.com, free monthly allowance).

## Other free AI options
In Settings you can also choose **Groq** or **OpenRouter** (free keys), or **Ollama** to run AI fully offline on your own computer. For Ollama, allow the app to reach it by starting Ollama with `OLLAMA_ORIGINS=https://YOUR-USERNAME.github.io`.

## Your data
- Projects and favourites are saved in the browser/app on each device. Use **Settings → Download backup** regularly and **Import backup** on a new device.
- Your AI key stays in your browser on your device. It is never written into the repository.

## Accuracy rules
- Every trend shows source, URL, publication date, observation date, last verified date and confidence.
- Fabric specs are labelled **Sourced**, **Estimate** or **Not verified**; GSM is never invented.
- Season (in stores now / next season) is calculated from today's date, never hardcoded.
- AI previews are labelled as previews, not production artwork.

## Files
```
index.html              the app (GitHub Pages serves it straight from the main branch)
assets/static.js        browser runtime: data, AI, storage, install
sw.js, manifest.webmanifest   offline + install support
data/research/*.json    trend records per market
data/fabrics.json       fabric database
scripts/update-research.js    weekly research (runs on GitHub)
.github/workflows/      weekly brand catalogues + weekly trend research
```

## Limits to know
- Free tiers (Gemini, Tavily, Pollinations images) are set by those companies and can change.
- AI image previews use Pollinations, a free community service; they can be slow and are sketches, not artwork.
- Not built yet: dedicated dress-style gallery with garment specs, collection builder, SVG export.
