# Trend research file schema (one file per country: research/<slug>.json)

{
  "country": "Pakistan",
  "slug": "pakistan",
  "researched_on": "2026-11-01",
  "season_context": {
    "hemisphere": "northern",
    "current_fashion_season": "e.g. Autumn/Winter 2026 (AW26)",
    "local_season_notes": "own words: climate + local retail calendar (festivals, wedding season, Ramadan/Eid timing etc.) relevant to Nov 2026 - Apr 2027",
    "upcoming_season": "e.g. Spring/Summer 2027",
    "sources": [{"title": "...", "url": "...", "published": "YYYY-MM-DD|YYYY-MM|unknown"}]
  },
  "trends": [
    {
      "category": "prints|dress_styles|fabrics|colors|silhouettes|embroidery|printing_techniques|casual|formal|luxury|modest|streetwear|seasonal|emerging",
      "status": "observed|recent|emerging|forecast|historical",
      "name": "short trend name",
      "summary": "<=45 words, entirely in YOUR OWN WORDS (no quotes, no copied phrasing)",
      "season": "e.g. AW26, SS27, Festive 2026, Winter 2026",
      "gender": "female|male|unisex|kids",
      "ages": ["18-25","26-40"],
      "source": "Publication / brand name",
      "source_url": "https://... (a URL you actually saw in search results or fetched)",
      "published": "YYYY-MM-DD or YYYY-MM or unknown (from the source itself, never guessed)",
      "confidence": "high|medium|low"
    }
  ]
}

Status rules:
- observed  = currently visible in shops/collections/runway that are on sale/shown now (source published within ~4 months, describing current product).
- recent    = published within last ~6 months describing the current season.
- emerging  = early signals noted by sources, not yet mainstream.
- forecast  = predictions for an upcoming season (SS27 etc). NEVER label a forecast as observed.
- historical= older than ~12 months; only include if useful context, and label it.
Confidence: high = multiple reputable sources agree or primary source (brand collection page, fashion week); medium = one reputable source; low = single weak/aggregator source.
