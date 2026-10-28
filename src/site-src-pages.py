# Renders all SEO pages: product category pages, local landing pages, blog, sitemap.xml, robots.txt, 404.
# Content lives in seo_products.py (products + prices) and seo_pages.py (local pages + blog posts).
import json, html, os, sys, datetime, urllib.parse
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from seo_products import P, BY, TURNAROUND, TURNAROUND_LONG
from seo_pages import LOCAL, BLOG, GAMEDAY
from design_catalog import build_design_assets
from order_catalog import build_order_catalog
from design_pages import HUB as DESIGN_HUB, PRODUCTS as DESIGN_PRODUCTS, PROOF as DESIGN_PROOF, start_price as design_start_price
SRC=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(SRC); SITE=ROOT  # repo root: built pages are written here
BASE='https://getseensignsco.com'
def _build_date():
    """The date used for sitemap lastmod and blog dateModified when a page has no explicit override.
    BUILD_DATE=YYYY-MM-DD fixes it (tests and reproducible rebuilds); otherwise it is today's date in America/New_York."""
    fixed=os.environ.get('BUILD_DATE')
    if fixed:
        try: return datetime.date.fromisoformat(fixed).isoformat()
        except ValueError: raise SystemExit('BUILD_DATE must look like 2026-10-28, got %r'%fixed)
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo('America/New_York')).date().isoformat()
    except Exception as err:
        raise SystemExit('could not read the America/New_York time zone (%s); set BUILD_DATE=YYYY-MM-DD'%err)
TODAY=_build_date()
ETSY='https://www.etsy.com/shop/GetSeenSigns'
# Public shop line. Links are plain sms:, tel: and wa.me URLs. No chat widget, script or tracker.
PHONE_DISPLAY='(334) 232-9003'
PHONE_TEL='+13342329003'
PHONE_SCHEMA='+1-334-232-9003'
MSG='Hi, I have a question about a sign'
SMS_HREF='sms:'+PHONE_TEL+'?body='+urllib.parse.quote(MSG)
WA_HREF='https://wa.me/13342329003?text='+urllib.parse.quote(MSG)
TEL_HREF='tel:'+PHONE_TEL
ORG_ID=BASE+'/#org'; SITE_ID=BASE+'/#website'
AREAS=['Columbus, GA','Phenix City, AL','Auburn, AL','Opelika, AL','Smiths Station, AL','Fort Benning, GA']
DESIGN_SLUGS={p['page']:p['slug'] for p in DESIGN_PRODUCTS}  # product page slug -> /design/<slug>/
# First-party event counts are off. To turn them on: set DESIGN_EVENTS_ENABLED=true on Cloudflare Pages,
# set this to True and rebuild (see src/README.md). While False the page makes no analytics requests.
DESIGN_EVENTS_CLIENT=False
e=html.escape
ORDER_CATALOG=build_order_catalog()
os.makedirs(SITE+'/assets/order', exist_ok=True)
with open(SITE+'/assets/order/catalog.json','w',encoding='utf-8') as _out:
    json.dump(ORDER_CATALOG, _out, ensure_ascii=False, indent=1)
    _out.write('\n')
import re as _r0
CSS=_r0.sub(r'\s*\n\s*','',open(SITE+'/assets/style.css').read()).replace('/*','\n/*')
CSS=_r0.sub(r'/\*.*?\*/','',CSS,flags=_r0.S)

def org():
    return {"@type":"Organization","@id":ORG_ID,"name":"Get Seen Signs",
      "url":BASE+"/","logo":BASE+"/assets/brand/getseen-horizontal-for-dark-bg.png","image":BASE+"/assets/og-image.jpg",
      "email":"sales@getseensignsco.com","telephone":PHONE_SCHEMA,
      "description":"Veteran-owned, family-run online sign shop in Smiths Station, Alabama. Custom yard signs, banners, feather flags, retractable banners, car magnets, backdrops, table throws and canopy tents, made to order and shipped.",
      "address":{"@type":"PostalAddress","addressLocality":"Smiths Station","addressRegion":"AL","addressCountry":"US"},
      "areaServed":[{"@type":"Country","name":"United States"}]+[{"@type":"City","name":a} for a in AREAS],
      "sameAs":[ETSY]}
def website():
    return {"@type":"WebSite","@id":SITE_ID,"url":BASE+"/","name":"Get Seen Signs","publisher":{"@id":ORG_ID},"inLanguage":"en-US"}
def crumbs(items):
    return {"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":i+1,"name":n,"item":BASE+u} for i,(n,u) in enumerate(items)]}
def faqpage(faqs):
    import re
    strip=lambda t: re.sub('<[^>]+>','',t)
    return {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":strip(a)}} for q,a in faqs]}
RETURNS={"@type":"MerchantReturnPolicy","applicableCountry":"US","returnPolicyCategory":"https://schema.org/MerchantReturnNotPermitted"}
# Free shipping lower 48 (shop-copy + product pages). Handling + transit add up to Etsy's wording:
# "Arrives 3-8 business days after proof approval; tents and backdrops 5-10 business days."
# Standard = 1-3 handling + 2-5 transit. Tents and backdrops = 3-5 + 2-5. A product can set handling=(lo,hi) and transit=(lo,hi).
def _qv(lo,hi): return {"@type":"QuantitativeValue","minValue":lo,"maxValue":hi,"unitCode":"DAY"}
# Free shipping covers the contiguous US only (the lower 48), so the destination lists those 48 state codes and leaves out AK and HI.
LOWER_48=['AL','AR','AZ','CA','CO','CT','DE','FL','GA','IA','ID','IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA','WI','WV','WY']
assert len(LOWER_48)==48 and len(set(LOWER_48))==48
def shipping_details(days='3-5', handling=None, transit=None):
    h=handling or ((3,5) if str(days).startswith('5') else (1,3))
    t=transit or (2,5)
    return {"@type":"OfferShippingDetails",
      "shippingRate":{"@type":"MonetaryAmount","value":"0","currency":"USD"},
      "shippingDestination":{"@type":"DefinedRegion","addressCountry":"US","addressRegion":list(LOWER_48)},
      "deliveryTime":{"@type":"ShippingDeliveryTime","handlingTime":_qv(*h),"transitTime":_qv(*t)}}
def offer(price, desc, days='3-5', ship=None, page_url=None):
    # The Offer points at our own product page (where the order panel is), never at an Etsy listing.
    return {"@type":"Offer","price":f"{price:.2f}","priceCurrency":"USD","availability":"https://schema.org/InStock",
            "url":page_url,"description":desc,"seller":{"@id":ORG_ID},
            "hasMerchantReturnPolicy":RETURNS,"shippingDetails":shipping_details(days,*(ship or (None,None)))}
def product(name, desc, img, url, price, etsy, base, days='3-5', offer_rows=None, ship=None):
    d={"@type":"Product","name":name,"description":desc,"image":[BASE+i for i in img],"url":BASE+url,"brand":{"@type":"Brand","name":"Get Seen Signs"}}
    if offer_rows:
        d["offers"]=[offer(pr, text, days, ship, BASE+url) for pr, text in offer_rows]
    elif price is not None:
        d["offers"]=offer(price, base, days, ship, BASE+url)
    return d
def ld(*nodes):
    return '<script type="application/ld+json">'+json.dumps({"@context":"https://schema.org","@graph":[org(),website(),*nodes]},ensure_ascii=False,separators=(',',':'))+'</script>'

def head(title, desc, path, ld_html, og_img='/assets/og-image.jpg', og_w=1200, og_h=630, otype='website', preload=None):
    pre=f'<link rel="preload" as="image" href="{preload}" type="image/webp" fetchpriority="high">' if preload else ''
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{BASE}{path}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#14161A">
<meta property="og:type" content="{otype}">
<meta property="og:site_name" content="Get Seen Signs">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{BASE}{path}">
<meta property="og:image" content="{BASE}{og_img}">
<meta property="og:image:width" content="{og_w}"><meta property="og:image:height" content="{og_h}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{BASE}{og_img}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/barlow-condensed-900.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/barlow-400.woff2" as="font" type="font/woff2" crossorigin>
{pre}
<style>{CSS}</style>
{ld_html}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
'''

NAV='''<header class="nav">
  <div class="wrap nav-in">
    <a class="nav-logo" href="/" aria-label="Get Seen Signs home"><img src="/assets/brand/getseen-wordmark-only-for-dark-bg.svg" alt="Get Seen Signs" width="150" height="58"></a>
    <nav class="nav-links" aria-label="Main">
      <a href="/shop/">Shop</a><a href="/#products">Products</a><a href="/design/">Design</a><a href="/signs-columbus-ga-phenix-city/">Columbus</a><a href="/signs-auburn-opelika-al/">Auburn</a><a href="/blog/">Guides</a><a href="/#faq">FAQ</a>
    </nav>
    <a class="nav-shop" href="/shop/">Shop</a>
    <a class="nav-design" href="/design/">Design</a>
    <a class="btn btn-y btn-sm" href="/#quote">Get a quote</a>
  </div>
</header>
'''
def reach_links():
    """Text, WhatsApp and phone. Visible text is the control name; aria-label names the destination."""
    sms=f'<a href="{SMS_HREF}" aria-label="Text us at {PHONE_DISPLAY}">Text us</a>'
    wa=f'<a href="{WA_HREF}" rel="noopener noreferrer" aria-label="Chat on WhatsApp with Get Seen Signs">Chat on WhatsApp</a>'
    tel=f'<a class="foot-phone" href="{TEL_HREF}" >{PHONE_DISPLAY}</a>'
    return sms, wa, tel
def chat_fab():
    sms, wa, tel=reach_links()
    return f'''<div class="chat-fab" id="chat-fab">
  <div class="chat-fab-panel" id="chat-fab-panel" hidden>
    <p class="chat-fab-title">Message Get Seen Signs</p>
    {sms}
    {wa}
    <a href="{TEL_HREF}" aria-label="Call {PHONE_DISPLAY} to reach Get Seen Signs">Call {PHONE_DISPLAY}</a>
  </div>
  <button type="button" class="chat-fab-btn" aria-expanded="false" aria-controls="chat-fab-panel" aria-label="Message Get Seen Signs">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    <span>Text us</span>
  </button>
</div>
'''
def foot(chat=True):
    prods=''.join(f'<a href="/{p["slug"]}/">{p["name"]}</a>' for p in P)
    sms, wa, tel=reach_links()
    fab=chat_fab() if chat else ''
    return f'''<footer class="foot">
  <div class="wrap foot-in">
    <div>
      <img src="/assets/brand/getseen-stacked-for-dark-bg.svg" alt="Get Seen Signs" width="150" height="118" loading="lazy">
      <p class="foot-tag">Veteran-owned, family-run online sign shop. Smiths Station, Alabama. Shipping free across the lower 48.</p>
    </div>
    <div class="foot-cols">
      <div class="foot-prods"><p class="fh">Products</p>{prods}</div>
      <div><p class="fh">Local</p><a href="/signs-columbus-ga-phenix-city/">Columbus &amp; Phenix City</a><a href="/signs-auburn-opelika-al/">Auburn &amp; Opelika</a><a href="/tailgate-and-gameday-signs/">Tailgate &amp; gameday</a><p class="fh mt">Guides</p><a href="/blog/welcome-home-military-retirement-banners/">Welcome home banners</a><a href="/blog/christmas-family-name-banner-ideas/">Christmas sign ideas</a><a href="/blog/election-yard-sign-rules-alabama-georgia/">Election sign rules</a><a href="/blog/senior-night-banner-ideas/">Senior night ideas</a><a href="/blog/">All guides</a></div>
      <div><p class="fh">Shop</p><a href="/shop/">Shop all products</a><a href="{ETSY}" target="_blank" rel="noopener">Etsy shop</a><a href="/design/">Design online</a><a href="/#quote">Get a quote</a><p class="fh mt">Reach us</p>{tel}{sms}{wa}<a href="mailto:sales@getseensignsco.com">sales@getseensignsco.com</a><a href="/#faq">FAQ</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></div>
    </div>
  </div>
  <div class="wrap legal">
    <p>© <span id="yr">2026</span> Get Seen Signs.</p>
  </div>
</footer>
{fab}
<script src="/assets/site.js" defer></script>
</body>
</html>
'''
def bc_html(items):
    out=[]
    for i,(n,u) in enumerate(items):
        out.append(f'<li><a href="{u}">{e(n)}</a></li>' if i<len(items)-1 else f'<li aria-current="page">{e(n)}</li>')
    return '<nav class="bc" aria-label="Breadcrumb"><ol>'+''.join(out)+'</ol></nav>'
def pic(base, alt, w, h, cls='', eager=False, sm=None, sizes='(max-width: 760px) 92vw, 560px'):
    smw=400 if '/p-' in base else 480
    srcset=f'{base}.webp' if not sm else f'{sm}.webp {smw}w, {base}.webp {w}w'
    sizes='' if not sm else f' sizes="{sizes}"'
    load='fetchpriority="high"' if eager else 'loading="lazy" decoding="async"'
    return f'<picture><source srcset="{srcset}"{sizes} type="image/webp"><img src="{base}.jpg" alt="{e(alt)}" width="{w}" height="{h}" {load}{" class="+chr(34)+cls+chr(34) if cls else ""}></picture>'
def faq_html(faqs):
    return '<div class="faq">'+''.join(f'<details{" open" if i==0 else ""}><summary>{e(q)}</summary><p>{a}</p></details>' for i,(q,a) in enumerate(faqs))+'</div>'
def money(v): return f'${v:,}'
def card(p):
    k=p['key']; pr=f'<span class="price"><small>from</small> {money(p["price"])}<small class="unit"> {p["unit"]}</small></span>' if p['price'] else '<span class="price price-na">See price on Etsy</span>'
    alt=HERO_ALT.get(k, p["name"]+" by Get Seen Signs")
    return f'''<a class="card" href="/{p["slug"]}/">
  <div class="card-img sq">{pic("/assets/img/p-"+k, alt, 1024, 1024, sm="/assets/img/p-"+k+"-sm", sizes="(max-width: 760px) 46vw, (max-width: 1180px) 30vw, 260px")}</div>
  <div class="card-body"><h3>{p["name"]}</h3>
  <div class="card-foot">{pr}<span class="go">Sizes &amp; details <span aria-hidden="true">→</span></span></div></div>
</a>'''
def quote_cta(product_label, extra=''):
    q=html.escape(product_label)
    return f'''<section class="sec yellow cta-band">
  <div class="wrap cta-band-in">
    <div><p class="eyebrow">Free proof · free shipping</p><h2>Need a custom size, a rush or a big order?</h2><p>Tell us what you need and we'll reply with a price and next steps, usually within 1 business day.{extra}</p></div>
    <div class="cta-row"><a class="btn btn-ink" href="/?product={urllib.parse.quote_plus(product_label)}#quote">Get a quote <span aria-hidden="true">→</span></a><a class="btn btn-line" href="mailto:sales@getseensignsco.com?subject={urllib.parse.quote('Quote: '+product_label)}">Email us</a></div>
    <p class="reach-line">Or <a href="{SMS_HREF}" aria-label="Text us at {PHONE_DISPLAY}">text us</a>, <a href="{WA_HREF}" rel="noopener noreferrer" aria-label="Chat on WhatsApp with Get Seen Signs">chat on WhatsApp</a>, or call <a href="{TEL_HREF}" >{PHONE_DISPLAY}</a>.</p>
  </div>
</section>'''
def write(path, s):
    full=SITE+path+('index.html' if path.endswith('/') else '')
    os.makedirs(os.path.dirname(full), exist_ok=True); open(full,'w').write(s)

# ---------- product pages ----------

# ---------- order panel (every product page with approved prices) ----------
def order_panel(p, d):
    """The 'Start my order' section. Prices shown here are the page prices; the order endpoint prices from the server's catalog."""
    slug=p['slug']; name=p['name']
    def sel(g):
        opts=''.join(f'<option value="{e(c["id"])}">{e(c["label"])}</option>' for c in g['choices'])
        return f'<label class="ord-field"><span>{e(g["label"])}</span><select name="g-{e(g["id"])}" data-group="{e(g["id"])}">{opts}</select></label>'
    groups=''.join(sel(g) for g in d['groups'])
    options=''.join(
        f'<label class="ord-field"><span>{e(o["label"])}</span><select name="o-{e(o["id"])}" data-option="{e(o["id"])}">'+''.join(f'<option value="{e(c["id"])}">{e(c["label"])}</option>' for c in o['choices'])+f'</select>{"<small>"+e(o["note"])+"</small>" if o["note"] else ""}</label>'
        for o in d['options'])
    addons=''
    if d['addons']:
        addons='<div class="ord-addons"><span class="ord-lab">Add-ons</span>'+''.join(
            f'<label class="ord-addon"><input type="checkbox" name="a-{e(a["id"])}" data-addon="{e(a["id"])}"> <span>{e(a["label"])} <b>{money(a["price"])}</b> each</span></label>' for a in d['addons'])+'</div>'
    qty=f'<label class="ord-field ord-qty"><span>How many {e(d["qtyLabel"])}?</span><input type="number" name="qty" min="1" max="{d["maxQty"]}" value="1" inputmode="numeric" required></label>'
    designer=''
    if d['designer']:
        designer=f'<label class="ord-path" id="ord-path-designer"><input type="radio" name="path" value="designer" checked> <span><b>Design it online</b> Open the designer with your options already picked, then send it for your free proof.</span></label>'
    first='' if d['designer'] else ' checked'
    paths=designer+f'<label class="ord-path"><input type="radio" name="path" value="upload"{first}> <span><b>I have my artwork or logo</b> Upload it here. PNG, JPG, WebP or SVG.</span></label><label class="ord-path"><input type="radio" name="path" value="dfm"> <span><b>Rather have us design it</b> Tell us the words and colors. Design help is part of your free proof.</span></label>'
    design_link=f'/design/{DESIGN_SLUGS_BY_ID[d["designer"]]}/' if d['designer'] else ''
    etsy=p.get('etsy')
    etsy_fine=f'Prefer Etsy? <a href="https://www.etsy.com/listing/{etsy}" target="_blank" rel="noopener">Order on Etsy</a> or <a href="/?product={urllib.parse.quote_plus(p["short"])}#quote">get a quote</a>.' if etsy else f'Prefer to ask first? <a href="/?product={urllib.parse.quote_plus(p["short"])}#quote">Get a quote</a>.'
    etsy_noscript=f'You can <a href="https://www.etsy.com/listing/{etsy}">order on Etsy</a> or <a href="/#quote">send a quote request</a>.' if etsy else 'You can <a href="/#quote">send a quote request</a>.'
    data=json.dumps(dict(slug=slug, name=name, designUrl=design_link, **{k:d[k] for k in ('groups','rows','addons','options','qtyLabel','maxQty','designer','designerMap','designerOk','uploadOnly')}), ensure_ascii=False, separators=(',',':')).replace('</','<\\/')
    return f'''<section class="sec paper2 ord" id="order" aria-labelledby="order-h">
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">Order this</p><h2 id="order-h">Start my order</h2>
    <p class="sub">Proof first, then pay. Pick your options and how you want it made. We email your free proof within 12 hours, 7 days a week, with 3 revisions included. Nothing is charged and nothing prints until you approve the proof and pay from your proof link.</p></div>
    <form class="ord-form" id="order-form" novalidate>
      <div class="ord-grid">
        <div class="ord-col">
          <fieldset class="ord-step"><legend><span class="num">1</span> Pick your options</legend>
            {groups}{options}{addons}{qty}
            <p class="ord-price" aria-live="polite"><span class="ord-total" id="ord-total"></span><small>Free shipping in the lower 48. Sales tax is added at checkout where required.</small></p>
          </fieldset>
          <fieldset class="ord-step"><legend><span class="num">2</span> How do you want to make it?</legend>
            <div class="ord-paths">{paths}</div>
            <p class="ord-fine" id="ord-design-off" hidden>The online designer does not cover this choice yet. Upload your artwork or let us design it, and your free proof comes the same way.</p>
            <div class="ord-panel" data-for="designer" hidden><a class="btn btn-ink btn-sm" id="ord-design" href="{design_link}">Open the designer <span aria-hidden="true">→</span></a><small>Your options carry over. In the designer, press "Get my free proof" when you are happy with it.</small></div>
            <div class="ord-panel" data-for="upload" hidden><label class="ord-field"><span>Your artwork or logo (up to 4 files, 25 MB each)</span><input type="file" name="logo" id="ord-files" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple></label></div>
            <div class="ord-panel" data-for="dfm" hidden><label class="ord-field"><span>The words you want on it</span><textarea name="wording" rows="3" maxlength="1000" placeholder="Business name, phone, website, anything else that goes on it"></textarea></label><label class="ord-field"><span>Website or logo link (optional)</span><input type="text" name="siteUrl" maxlength="200"></label><label class="ord-field"><span>Have a logo file? (optional)</span><input type="file" name="dfmlogo" id="ord-dfm-files" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple></label></div>
          </fieldset>
        </div>
        <div class="ord-col">
          <fieldset class="ord-step"><legend><span class="num">3</span> Your details</legend>
            <p class="ord-panel" data-for="designer" hidden><small>In the designer you enter your name and email when you press "Get my free proof".</small></p>
            <div class="ord-details">
            <label class="ord-field"><span>Name</span><input name="name" autocomplete="name" maxlength="120" required></label>
            <label class="ord-field"><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="200" required></label>
            <label class="ord-field"><span>Phone (optional)</span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
            <label class="ord-field"><span>Needed by (optional)</span><input name="eventDate" type="date"></label>
            <label class="ord-field"><span>Notes (optional)</span><textarea name="notes" rows="3" maxlength="2000" placeholder="Colors, sizes, wording for each sign, where it will be used"></textarea></label>
            <input type="text" name="_gotcha" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
            </div>
            <button class="btn btn-y" type="submit" id="ord-submit">Start my order <span aria-hidden="true">→</span></button>
            <p class="ord-status" id="ord-status" role="status" aria-live="polite"></p>
            <p class="ord-fine">No payment now. When your proof is ready we email you a private link to approve it and pay securely with Stripe. {etsy_fine}</p>
          </fieldset>
        </div>
      </div>
      <noscript><p class="ord-fine">Ordering here needs JavaScript. {etsy_noscript}</p></noscript>
    </form>
    <script type="application/json" id="order-data">{data}</script>
  </div>
</section>'''

DESIGN_SLUGS_BY_ID={p['id']:p['slug'] for p in DESIGN_PRODUCTS}
ALT2={ # alt text for the in-use example photo (2.jpg) and close-up (3.jpg) per listing
 '01-custom-yard-sign':('Example 18×24 custom yard sign for a lawn care business on a metal H-stake','Close-up of a coroplast yard sign on its wire H-stake in grass'),
 '02-bulk-yard-signs':('Stack of printed campaign yard signs for a school board race','Stack of printed VOTE PAT HOLLOWAY campaign signs with a bundle of H-stakes'),
 '03-vinyl-banner':('Yellow Now Open vinyl banner hung outside a hardware store','Close-up of a hemmed vinyl banner edge with a metal grommet and tie'),
 '04-feather-flag':('Two red Sale feather flags in a parking lot','Close-up of a feather flag sleeve on its pole'),
 '05-retractable-banner':('Retractable banner stand for a dental office at an event','Retractable banner base with the print rolled out of the aluminum cassette'),
 '06-car-magnet':('Custom car door magnet for a plumbing company on a van','Hand pressing a SUMMIT PLUMBING car magnet flat onto a white truck door'),
 '07-real-estate-sign':('For sale real estate sign with an Open House rider in a front yard','Close-up of a real estate sign hanging from a post frame'),
 '08-step-and-repeat':('Guests posing in front of a step and repeat logo backdrop at a gala','Close-up of a step and repeat backdrop on its telescoping stand'),
 '09-table-throw':('Green logo table throw on a farmers market vendor table','Close-up of the corner of a fitted table throw'),
 '10-canopy-tent':('Orange custom 10×10 canopy tent with a printed valance at an outdoor event','Close-up of a canopy tent leg and printed top corner'),
 '11-christmas-family-banner':('Red Merry Christmas family name banner on a porch rail','Close-up of a red vinyl banner tied to a porch rail with grommets'),
 '12-senior-night-banner':('Navy senior night banner with name, number and class year on a ballfield fence','Close-up of a vinyl banner zip-tied to a chain-link fence through grommets'),
 '15-vendor-booth-kit':('Trade show booth kit with a custom table throw, a retractable banner and a feather flag', None),
 '14-thanksgiving-yard-sign':('Give Thanks family name yard sign with fall pumpkins',None),
 '16-hard-hat-decals':('Row of hard hats on wall hooks, each with the same die-cut logo decal','Pile of die-cut logo decals on a gray surface'),
 '17-aluminum-safety-signs':('Warning Authorized Personnel Only aluminum safety sign hung on a chain-link fence','Stack of custom aluminum safety signs on a workbench'),
 '18-challenge-coins':('Custom challenge coin held in a hand to show its 1.75 inch size','Box of custom challenge coins lined up, with four more coins in clear cases in front'),
 '19-custom-patches':('Custom patches price card: 50 PVC patches 3 in $329, 50 embroidered patches $239, 100 embroidered patches $309',None),
}
# Alt text for the current Etsy listing main photo (p-*.jpg). Gallery shots that Etsy did not expose stay on their own alts above.
HERO_ALT={
 '02-bulk-yard-signs':'Five Vote Maria Lopez school board yard signs with eagles lined along a suburban sidewalk',
 '03-vinyl-banner':'Riverside Tigers 12U baseball champions vinyl banner zip-tied to a ballfield fence',
 '04-feather-flag':'Two orange Taco Loco Now Open feather flags outside a strip-mall storefront',
 '05-retractable-banner':'Aqua Pro Plumbing retractable banner stand at an indoor expo',
 '06-car-magnet':'Bulldog Lawn Care car magnet on a white pickup truck door',
 '07-real-estate-sign':'Lionheart Realty for-sale sign with an Open House Sunday rider in a front yard',
 '08-step-and-repeat':'Purple Westview Wolves Spring Gala 2026 step and repeat backdrop on a red carpet in a gym',
 '09-table-throw':'Yellow Buzz Bros Honey table throw at an outdoor vendor market',
 '10-canopy-tent':'Green Northside Hornets soccer canopy tent with a Go Hornets back wall at a tournament',
 '11-christmas-family-banner':'Merry Christmas from the Martinez Family snowman banner on a decorated porch rail',
 '12-senior-night-banner':'Senior night banner for Jake Morrison, number 12, Oak Ridge Rams, on a football field fence',
 '14-thanksgiving-yard-sign':'Happy Thanksgiving yard sign for the Johnsons in a leafy fall yard',
 '15-vendor-booth-kit':"Smokin' Joe's BBQ vendor booth with a matching table throw, retractable banner and feather flag at a farmers market",
 '16-hard-hat-decals':'White hard hat with a custom die-cut Acme Mfg logo decal on a shop bench',
 '17-aluminum-safety-signs':'Four custom aluminum safety signs reading Notice, Caution and Warning on a shop wall',
 '18-challenge-coins':'Front and back of a custom full color Acme Mfg challenge coin on dark slate',
 '19-custom-patches':'Custom patches, PVC and embroidered, from Get Seen Signs',
}
for p in P:
    path=f'/{p["slug"]}/'; k=p['key']; items=[('Home','/'),(p['name'],path)]
    imgs=[f'/assets/img/p-{k}.jpg', f'/assets/img/g-{k}-2.jpg']
    ship=(p.get('handling'),p.get('transit'))
    if p.get('extra'):
        nodes=[product(x['name'], p['desc'], [f'/assets/img/p-{x["key"]}.jpg'], path, x['price'], x['etsy'], x['base'], p['days'], x.get('offer_rows'), ship) for x in p['extra']]
    else:
        nodes=[product(p['name'], p['desc'], imgs, path, p['price'], p.get('etsy'), p['base'], p['days'], p.get('offer_rows'), ship)]
    nodes+= [crumbs(items), faqpage(p['faqs']), {"@type":"WebPage","@id":BASE+path,"url":BASE+path,"name":p['title'],"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID}}]
    if p['price']:
        design=' Design included — no design fee.' if p.get('design_included') else ''
        price_html=f'<p class="pp"><span class="price"><small>from</small> {money(p["price"])}<small class="unit"> {p["unit"]}</small></span><span class="pp-note">{e(p["base"]) or "Starting price"} · free shipping, lower 48.{design}</span></p>'
    else:
        price_html='<p class="pp"><span class="pp-note">Pricing is being updated. See the current price on Etsy, or get a quote.</span></p>'
    turn=p.get('turnaround') or (TURNAROUND_LONG if p['days']=='5-10' else TURNAROUND)
    spec=f'''<dl class="spec">
<div><dt>Sizes</dt><dd>{"<br>".join(e(s) for s in p["sizes"])}</dd></div>
<div><dt>Material</dt><dd>{e(p["material"])}</dd></div>
<div><dt>Included</dt><dd>{e(p["included"])}</dd></div>
<div><dt>Turnaround</dt><dd>{e(turn)} Rush on request.</dd></div>
{('<div><dt>Design</dt><dd>Design included — no design fee.</dd></div>' if p.get('design_included') else '')}
<div><dt>Proof</dt><dd>Free digital proof within 12 hours, 7 days a week, 3 revisions included. Nothing prints until you approve.</dd></div>
<div><dt>Shipping</dt><dd>Free in the lower 48</dd></div>
<div><dt>Your artwork</dt><dd>Logos, photos and text you send are your responsibility. You confirm you have the right to use them. We don't print team, school or league names, logos or slogans.</dd></div>
</dl>'''
    a2,a3=ALT2[k]
    gal=[(f'/assets/img/g-{k}-2',a2)]
    if a3 and os.path.exists(f'{SITE}/assets/img/g-{k}-3.webp'): gal.append((f'/assets/img/g-{k}-3',a3))
    if p.get('extra'):
        gal=[(f'/assets/img/g-{x["key"]}-2',ALT2[x['key']][0]) for x in p['extra']]
    gal+=[(b,a) for b,a in p.get('gallery_extra',[])]
    def _gfig(b,a,cap):
        w,h=Image.open(f'{SITE}{b}.webp').size
        return f'<figure{" class=sq" if w==h else ""}>{pic(b,a,w,h,sm=b+"-sm")}<figcaption>{cap}</figcaption></figure>'
    vids=''.join(f'<figure class="vid"><video controls muted playsinline preload="none" poster="/assets/video/{n}-poster.jpg" width="720" height="720"><source src="/assets/video/{n}.mp4" type="video/mp4"></video><figcaption>{e(cap)} in action</figcaption></figure>' for n,cap in p.get('videos',[]))
    gal_html='<div class="gal">'+vids+''.join(_gfig(b,a,'Banner materials' if b.endswith('-materials') else 'Pack pricing' if b.endswith('-pricing') or b.endswith('-patches-2') else 'Size and specs' if b.endswith('-specs') else 'Example design') for b,a in gal)+'</div>'
    body=''.join(f'<h2>{e(h)}</h2><p>{t}</p>' for h,t in p['body'])
    if p.get('extra'):
        buy='<div class="buy-list">'+''.join(f'<a class="buy" href="https://www.etsy.com/listing/{x["etsy"]}" target="_blank" rel="noopener"><span><b>{e(x["name"])}</b><small>{e(x["base"])}</small></span><span class="price"><small>from</small> {money(x["price"])}</span><span class="go">Etsy <span aria-hidden="true">→</span></span></a>' for x in p['extra'])+'</div>'
        etsy_btn=f'<a class="btn btn-ghost" href="#buy">Shop the designs on Etsy <span aria-hidden="true">↓</span></a>'
    else:
        buy=''
        etsy_btn=f'<a class="btn btn-ghost" href="https://www.etsy.com/listing/{p["etsy"]}" target="_blank" rel="noopener">Order on Etsy <span aria-hidden="true">→</span></a>' if p.get('etsy') else ''
    rel=''.join(card(BY[s]) for s in p['related'])
    design_btn=(f'<a class="btn btn-ghost" href="/design/{DESIGN_SLUGS[p["slug"]]}/">Design yours online</a>' if p['slug'] in DESIGN_SLUGS else '')
    hero_img=pic(f'/assets/img/p-{k}', HERO_ALT.get(k, f'{p["name"]} by Get Seen Signs'), 1024, 1024, eager=True)
    og_w,og_h=Image.open(f'{SITE}/assets/img/g-{k}-2.jpg').size
    page=head(p['title'],p['desc'],path,ld(*nodes),og_img=f'/assets/img/g-{k}-2.jpg',og_w=og_w,og_h=og_h,otype='product',preload=f'/assets/img/p-{k}.webp')+NAV+f'''<main id="main">
<section class="phero ink">
  <div class="wrap">
    {bc_html(items)}
    <div class="phero-in">
      <div>
        <h1>{e(p["h1"][0])} <span class="block">{e(p["h1"][1])}</span></h1>
        <p class="lede">{e(p["lede"])}</p>
        {price_html}
        <div class="cta-row"><a class="btn btn-y" href="#order">Start my order <span aria-hidden="true">↓</span></a>{etsy_btn}{design_btn}<a class="btn btn-ghost" href="/?product={urllib.parse.quote_plus(p["short"])}#quote">Get a quote</a></div>
      </div>
      <figure class="phero-img sq">{hero_img}</figure>
    </div>
  </div>
</section>
{order_panel(p, ORDER_CATALOG['products'][p['slug']])}
<section class="sec paper">
  <div class="wrap two">
    <div><p class="eyebrow">Sizes &amp; specs</p><h2 class="h2s">What you get</h2>{spec}{buy and '<h2 class="h2s" id="buy">Pick a design</h2>'+buy}</div>
    <div>{gal_html}</div>
  </div>
</section>
<section class="sec paper2">
  <div class="wrap prose">{body}</div>
</section>
<section class="sec paper">
  <div class="wrap faq-in">
    <div class="sec-head"><p class="eyebrow">FAQ</p><h2>{e(p["short"])} questions</h2></div>
    {faq_html(p["faqs"])}
  </div>
</section>
{quote_cta(p["short"])}
<section class="sec paper">
  <div class="wrap"><h2 class="group">Related products</h2><div class="grid grid-3">{rel}</div></div>
</section>
</main>
'''+foot()
    page=page.replace('</head>','<link rel="stylesheet" href="/assets/order/order.css">\n</head>',1).replace('</body>','<script type="module" src="/assets/order/order.js"></script>\n</body>',1)
    write(path,page)

# ---------- local pages ----------
for L in LOCAL:
    path=f'/{L["slug"]}/'; items=[('Home','/'),(f'Signs in {L["area"]}',path)]
    svc={"@type":"Service","name":f"Custom signs and banners for {L['area']}","serviceType":"Custom sign and banner printing","provider":{"@id":ORG_ID},
         "areaServed":[{"@type":"City","name":c} if ',' in c and 'County' not in c else {"@type":"AdministrativeArea","name":c} for c in L['places']],"url":BASE+path}
    nodes=[svc, crumbs(items), faqpage(L['faqs']), {"@type":"WebPage","@id":BASE+path,"url":BASE+path,"name":L['title'],"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID}}]
    grid=''.join(card(p) for p in P[:8])
    page=head(L['title'],L['desc'],path,ld(*nodes))+NAV+f'''<main id="main">
<section class="phero ink">
  <div class="wrap">
    {bc_html(items)}
    <div class="phero-in phero-local">
      <div>
        <h1>{e(L["h1"][0])} <span class="block">{e(L["h1"][1])}</span></h1>
        <p class="lede">{e(L["lede"])}</p>
        <ul class="proof"><li><b>Free</b> design proof</li><li><b>Free</b> shipping to your door</li><li><b>Veteran</b>-owned</li></ul>
        <div class="cta-row"><a class="btn btn-y" href="/#quote">Get a quote <span aria-hidden="true">→</span></a><a class="btn btn-ghost" href="{ETSY}" target="_blank" rel="noopener">Shop on Etsy</a></div>
      </div>
      <figure class="phero-img">{pic(L["img"][0],L["img"][1],900,675,eager=True)}</figure>
    </div>
  </div>
</section>
<section class="sec paper"><div class="wrap prose">{L["html"]}</div></section>
<section class="sec paper2">
  <div class="wrap"><h2 class="group">Popular for {e(L["area"])}</h2><div class="grid">{grid}</div></div>
</section>
<section class="sec paper">
  <div class="wrap faq-in"><div class="sec-head"><p class="eyebrow">FAQ</p><h2>Local questions</h2></div>{faq_html(L["faqs"])}</div>
</section>
{quote_cta("Something else")}
</main>
'''+foot()
    write(path,page)


# ---------- gameday / tailgate page (NO TRADEMARKS) ----------
G=GAMEDAY; path=f'/{G["slug"]}/'; items=[('Home','/'),('Tailgate & gameday signs',path)]
def gimg(gd, fb):
    if gd and os.path.exists(f'{SITE}/assets/img/{gd}.webp'): return f'/assets/img/{gd}', True
    return f'/assets/img/{fb}', False
gcards=''; gimgs=[]
for gd,fb,alt,name,words,price,link in G['products']:
    b,real=gimg(gd,fb); gimgs.append(b+'.jpg')
    smb=b+'-sm' if os.path.exists(f'{SITE}{b}-sm.webp') else None
    tag=''  # no 'Photo coming' tag; real gd-* mockups swap in automatically when present
    gcards+=f'<a class="card" href="{link}"><div class="card-img">{pic(b, alt if real or not gd else "Example product photo", 900, 675, sm=smb, sizes="(max-width: 760px) 46vw, (max-width: 1180px) 30vw, 360px")}{tag}</div><div class="card-body"><h3>{e(name)}</h3><p>{e(words)}</p><div class="card-foot"><span class="price gd-price">{price}</span><span class="go">Sizes &amp; details <span aria-hidden="true">→</span></span></div></div></a>'
sw=''.join(f'<li><span class="sw" style="background:linear-gradient(90deg,{a} 50%,{b} 50%)"></span>{n}</li>' for n,a,b in G['colors'])
hero_b,hero_real=gimg('gd-tailgate-tent-orange-navy','g-10-canopy-tent-2')
coll={"@type":"CollectionPage","@id":BASE+path,"url":BASE+path,"name":G['title'],"description":G['desc'],"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID},
      "mainEntity":{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":i+1,"name":x[3],"url":BASE+x[6]} for i,x in enumerate(G['products'])]}}
svc={"@type":"Service","name":"Tailgate tents and gameday signs","serviceType":"Custom sign, banner and tent printing","provider":{"@id":ORG_ID},
     "areaServed":[{"@type":"City","name":c} for c in ['Columbus, GA','Phenix City, AL','Auburn, AL','Opelika, AL','Smiths Station, AL']],"url":BASE+path}
page=head(G['title'],G['desc'],path,ld(coll,svc,crumbs(items),faqpage(G['faqs'])),og_img=hero_b+'.jpg',og_w=900,og_h=675,preload=hero_b+'.webp')+NAV+f'''<main id="main">
<section class="phero ink">
  <div class="wrap">
    {bc_html(items)}
    <div class="phero-in phero-local">
      <div>
        <h1>{e(G["h1"][0])} <span class="block">{e(G["h1"][1])}</span></h1>
        <p class="lede">{e(G["lede"])}</p>
        <ul class="proof"><li><b>Free</b> design proof</li><li><b>Free</b> shipping to your door</li><li><b>Veteran</b>-owned</li></ul>
        <div class="cta-row"><a class="btn btn-y" href="/?product=Tailgate+%2F+gameday#quote">Get a quote <span aria-hidden="true">→</span></a><a class="btn btn-ghost" href="{ETSY}" target="_blank" rel="noopener">Shop on Etsy</a></div>
      </div>
      <figure class="phero-img">{pic(hero_b,"Navy canopy tent with an orange TAILGATE HQ valance at a tailgate" if hero_real else "Example custom 10×10 canopy tent",900,675,eager=True)}</figure>
    </div>
  </div>
</section>
<section class="sec paper2">
  <div class="wrap"><div class="sec-head"><p class="eyebrow">The gameday line</p><h2>Pick it. Color it. <span class="hl">Name it.</span></h2>
  <p class="sub">Every price includes a free proof and free shipping in the lower 48.</p></div>
  <ul class="swatches">{sw}<li><span class="sw sw-any"></span>Or any colors you want</li></ul>
  <div class="grid grid-3">{gcards}</div></div>
</section>
<section class="sec paper"><div class="wrap prose">{G["html"]}
<h2>Local to you</h2><p>We\'re based in Smiths Station, between Phenix City and Auburn. See <a href="/signs-columbus-ga-phenix-city/">signs for Columbus and Phenix City</a> and <a href="/signs-auburn-opelika-al/">signs for Auburn and Opelika</a>.</p></div></section>
<section class="sec paper2">
  <div class="wrap faq-in"><div class="sec-head"><p class="eyebrow">FAQ</p><h2>Gameday questions</h2></div>{faq_html(G["faqs"])}</div>
</section>
{quote_cta("Tailgate / gameday")}
</main>
'''+foot()
page=page.replace('</style>','.swatches{list-style:none;display:flex;flex-wrap:wrap;gap:10px 18px;margin:0 0 28px;padding:0}.swatches li{display:flex;align-items:center;gap:8px;font-weight:600}.sw{display:inline-block;width:34px;height:22px;border:2px solid var(--ink);border-radius:5px}.sw-any{background:conic-gradient(#FFD100,#C8102E,#13274F,#2E7D32,#FFD100)}.gd-price{font-size:15px;font-family:inherit}.gd-price b{font-size:20px}</style>',1)
write(path,page)
print('gameday ok', 'hero real' if hero_real else 'hero fallback')

# ---------- blog ----------
posts_cards=''
for b in BLOG:
    path=f'/blog/{b["slug"]}/'; items=[('Home','/'),('Guides','/blog/'),(b['h1'],path)]
    og=b['img']
    art={"@type":"BlogPosting","headline":b['h1'],"description":b['desc'],"datePublished":b['date'],"dateModified":max(b['date'],TODAY),"inLanguage":"en-US",
         "author":{"@id":ORG_ID},"publisher":{"@id":ORG_ID},"mainEntityOfPage":BASE+path,"image":BASE+og}
    nodes=[art, crumbs(items)]
    img=pic(og[:-4],b['img_alt'],900,675,eager=True)
    d=datetime.date.fromisoformat(b['date'])
    page=head(b['title'],b['desc'],path,ld(*nodes),og_img=og,og_w=900,og_h=675,otype='article',preload=og[:-4]+'.webp')+NAV+f'''<main id="main">
<article>
<section class="phero ink">
  <div class="wrap">
    {bc_html(items)}
    <div class="phero-in">
      <div>
        <p class="eyebrow">{e(b["kicker"])} · <time datetime="{b["date"]}">{d:%B} {d.day}, {d.year}</time></p>
        <h1 class="h1-post">{e(b["h1"])}</h1>
        <p class="lede">{e(b["lede"])}</p>
      </div>
      <figure class="phero-img">{img}</figure>
    </div>
  </div>
</section>
<section class="sec paper"><div class="wrap prose">{b["html"]}</div></section>
</article>
{quote_cta(b["quote"])}
</main>
'''+foot()
    write(path,page)
    posts_cards+=f'<a class="post" href="{path}"><div class="card-img">{pic(og[:-4],"",900,675)}</div><div class="card-body"><p class="eyebrow">{e(b["kicker"])}</p><h3>{e(b["h1"])}</h3><p>{e(b["desc"])}</p><span class="go">Read the guide <span aria-hidden="true">→</span></span></div></a>'
path='/blog/'; items=[('Home','/'),('Guides','/blog/')]
title='Sign Guides & How-Tos | Get Seen Signs'
desc='Practical guides from Get Seen Signs: welcome home banners, Christmas family name banners, Alabama and Georgia election sign rules, senior night ideas.'
page=head(title,desc,path,ld(crumbs(items),{"@type":"Blog","@id":BASE+path,"url":BASE+path,"name":"Get Seen Signs Guides","publisher":{"@id":ORG_ID}}))+NAV+f'''<main id="main">
<section class="phero ink"><div class="wrap">{bc_html(items)}<h1>Sign <span class="block">guides.</span></h1><p class="lede">Straight answers for people buying signs: the rules, the sizes and the timing.</p></div></section>
<section class="sec paper"><div class="wrap"><div class="posts">{posts_cards}</div></div></section>
</main>
'''+foot()
write(path,page)

# ---------- online designer: /design/ and one page per product ----------
CATALOG, PRINT_SPECS, TEMPLATES = build_design_assets()
os.makedirs(SITE+'/assets/design', exist_ok=True)
for _name,_data in (('catalog',CATALOG),('print-specs',PRINT_SPECS),('templates',TEMPLATES)):
    with open(SITE+f'/assets/design/{_name}.json','w',encoding='utf-8') as _out:
        json.dump(_data, _out, ensure_ascii=False, indent=2)
        _out.write('\n')
for _prod in CATALOG['products']:
    for _row in _prod['prices']:
        if f"{_row['source']}|{_row['offer']}" not in ORDER_CATALOG['offers']:
            raise SystemExit(f"order catalog: designer price row {_prod['id']} {_row['offer']!r} has no SKU in order_catalog.py")
print('design prices:', ', '.join(p['id']+' $'+str(p['prices'][0]['price']) for p in CATALOG['products']))

def design_modules(entry='assets/design/main.js'):
    """Every ES module the page loads up front (static imports only), so they can be preloaded in one go.
    The 3D stage is imported lazily and is deliberately not in this list."""
    import re
    seen=[]; queue=[entry]
    pat=re.compile(r"""(?:import|export)\s[^;'"]*?\sfrom\s*['"](\.{1,2}/[^'"]+)['"]|import\s*['"](\.{1,2}/[^'"]+)['"]""")
    while queue:
        rel=queue.pop(0)
        if rel in seen: continue
        seen.append(rel)
        src=open(f'{SITE}/{rel}',encoding='utf-8').read()
        for m in pat.finditer(src):
            queue.append(os.path.normpath(os.path.join(os.path.dirname(rel), m.group(1) or m.group(2))))
    return seen

_dcss=_r0.sub(r'/\*.*?\*/','',open(SITE+'/assets/design/editor.css',encoding='utf-8').read(),flags=_r0.S)
_dcss=_r0.sub(r'\s*\n\s*','',_dcss)
DESIGN_HEAD_HUB=('<style>'+_dcss+'</style>\n'
  '<script type="importmap">{"imports":{"three":"/assets/design/vendor/three.module.min.js"}}</script>\n')
DESIGN_HEAD=DESIGN_HEAD_HUB+''.join(f'<link rel="preload" href="/assets/design/{n}.json" as="fetch" crossorigin>\n' for n in ('catalog','print-specs','templates'))
# Preloading the module graph from the end of the body flattens the request chain without competing with
# the first paint (modulepreload is allowed in <body>). The hub only loads hub.js, which fetches the editor
# when a shared link needs it.
DESIGN_PRELOAD=''.join(f'<link rel="modulepreload" href="/{m}">\n' for m in design_modules())

def design_mock(slug, alt, lazy=True, high=False):
    k=BY[slug]['key']
    sm=Image.open(f'{SITE}/assets/img/p-{k}-sm.webp')
    load='loading="lazy" decoding="async"' if lazy else ('fetchpriority="high" decoding="async"' if high else 'decoding="async"')
    return f'<picture><source srcset="/assets/img/p-{k}-sm.webp" type="image/webp"><img src="/assets/img/p-{k}.jpg" alt="{e(alt)}" width="{sm.width}" height="{sm.height}" {load}></picture>'

def design_page(path, title, desc, h1, lede, items, pre_html, product_id, copy_html, faqs, hub=False):
    ldnodes=[crumbs(items), faqpage(faqs), {"@type":"WebPage","@id":BASE+path,"url":BASE+path,"name":title,"description":desc,"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID}}]
    page=head(title, desc, path, ld(*ldnodes))
    page=page.replace('</head>', (DESIGN_HEAD_HUB if hub else DESIGN_HEAD)+'</head>',1)
    mount=(f'<div id="designer" class="designer{" designer-hub" if hub else ""}" data-assets="/assets/design/"'
           +(f' data-product="{product_id}"' if product_id else '')
           +(' data-events="1"' if DESIGN_EVENTS_CLIENT else '')+'>'+pre_html+'</div>')
    page+=NAV+f'''<main id="main">
<section class="phero ink designer-hero">
  <div class="wrap">
    {bc_html(items)}
    <h1>{e(h1[0])} <span class="block">{e(h1[1])}</span></h1>
    <p class="lede">{e(lede)}</p>
  </div>
</section>
<section class="sec paper designer-sec">
  <div class="wrap">
    {mount}
  </div>
</section>
<section class="sec paper2">
  <div class="wrap two">
    <div class="designer-copy">{copy_html}</div>
    <div class="faq-in">
      <div class="sec-head"><p class="eyebrow">FAQ</p><h2>About the designer</h2></div>
      {faq_html(faqs)}
    </div>
  </div>
</section>
</main>
'''
    page+=foot(False)
    page=page.replace('</body>',('' if hub else DESIGN_PRELOAD)+f'<script type="module" src="/assets/design/{"hub" if hub else "main"}.js"></script>\n</body>',1)
    write(path, page)

NOSCRIPT=f'<noscript><p>The designer needs JavaScript. Email <a href="mailto:sales@getseensignsco.com">sales@getseensignsco.com</a>, <a href="{SMS_HREF}" aria-label="Text us at {PHONE_DISPLAY}">text us</a>, or <a href="{WA_HREF}" rel="noopener noreferrer" aria-label="Chat on WhatsApp with Get Seen Signs">chat on WhatsApp</a> at <a href="{TEL_HREF}" >{PHONE_DISPLAY}</a> and we will make the proof with you.</p></noscript>'

# hub: /design/ lists the five products as plain links. The editor itself lives on the product pages.
_cards=''.join(
  f'<a class="dz-card" href="/design/{d["slug"]}/">'
  f'<span class="dz-card-thumb">{design_mock(d["page"], d["alt"], lazy=i > 2, high=i == 0)}</span>'
  f'<b>{e(d["short"].capitalize())}</b><span>{e(d["name"][0].upper()+d["name"][1:])}</span>'
  f'<span class="dz-from">from {money(design_start_price(d["page"]))} · free shipping</span></a>'
  for i, d in enumerate(DESIGN_PRODUCTS))
_hub_pre=f'<section class="dz-picker" aria-labelledby="dz-pick-title"><h2 id="dz-pick-title">What are you designing?</h2><p class="dz-help">Pick one. Free design proof within 12 hours, 7 days a week.</p><div class="dz-picker-grid">{_cards}</div></section>'
_hub_copy=(
  '<h2>How it works</h2>'
  '<ol class="designer-steps"><li>Pick a product.</li><li>Choose a layout, then change the words, colors and font and add your logo.</li>'
  '<li>Turn it around in 3D to check every side.</li><li>Send it. We email '+DESIGN_PROOF+'. Nothing prints until you approve.</li></ol>'
  '<h2>What you can design</h2><p>'+', '.join(f'<a href="/design/{d["slug"]}/">{e(d["name"])}</a>' for d in DESIGN_PRODUCTS[:-1])+' and <a href="/design/'+DESIGN_PRODUCTS[-1]['slug']+'/">'+e(DESIGN_PRODUCTS[-1]['name'])+'</a>. Prices match our Etsy listings and shipping is free in the lower 48.</p>'
  '<h2>Good to know</h2><p>The designer shows your words, colors and logo on the product. It is a preview, not the print file: we build that on your free proof. Your logo stays on your device until you send your proof request.</p>')
design_page('/design/', DESIGN_HUB['title'], DESIGN_HUB['desc'], DESIGN_HUB['h1'], DESIGN_HUB['lede'],
            [('Home','/'),('Design online','/design/')], _hub_pre, '', _hub_copy, DESIGN_HUB['faqs'], hub=True)

for d in DESIGN_PRODUCTS:
    path=f'/design/{d["slug"]}/'
    prod=BY[d['page']]
    secs=''.join(f'<h2>{e(h)}</h2><p>{e(t.format(price=money(design_start_price(d["page"])), proof=DESIGN_PROOF))}</p>' for h,t in d['sections'])
    others=''.join(f'<li><a href="/design/{o["slug"]}/">Design a {e(o["short"])}</a></li>' for o in DESIGN_PRODUCTS if o is not d)
    copy=(secs+f'<p><a class="btn btn-y" href="/{d["page"]}/">See the {e(d["short"])} page</a></p>'
          +f'<h2>Design something else</h2><ul class="designer-more"><li><a href="/design/">All products</a></li>{others}</ul>')
    pre=f'<p class="designer-loading">Loading the designer…</p>{NOSCRIPT}'
    copy=f'<div class="designer-mock">{design_mock(d["page"], d["alt"])}</div>'+copy
    design_page(path, d['title'], d['desc'], d['h1'], d['lede'],
                [('Home','/'),('Design online','/design/'),(f'Design a {d["short"]}',path)], pre, d['id'], copy, d['faqs'])

# ---------- terms, privacy, contact ----------
# Body copy for /terms and /privacy is the approved legal text in src/legal/.
# Render it as written: same words, in the same order. Links are only on
# addresses, the phone number, and the opt-out URL already in that text.
def _legal_inline(s):
    s=e(s)
    s=_r0.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s=s.replace('sales@getseensignsco.com', '<a href="mailto:sales@getseensignsco.com">sales@getseensignsco.com</a>')
    s=s.replace(PHONE_DISPLAY, f'<a href="{TEL_HREF}" >{PHONE_DISPLAY}</a>')
    opt='tools.google.com/dlpage/gaoptout'
    s=s.replace(opt, f'<a href="https://{opt}" rel="noopener noreferrer">{opt}</a>')
    s=s.replace('text us', f'<a href="{SMS_HREF}" aria-label="Text us at {PHONE_DISPLAY}">text us</a>')
    s=s.replace('chat on WhatsApp', f'<a href="{WA_HREF}" rel="noopener noreferrer" aria-label="Chat on WhatsApp with Get Seen Signs">chat on WhatsApp</a>')
    return s
def _legal_norm_md(md):
    s=_r0.sub(r'^\d+\. +', '', md, flags=_r0.M)
    s=_r0.sub(r'^#{1,6} +', '', s, flags=_r0.M)
    s=s.replace('**', '')
    s=_r0.sub(r'^- +', '', s, flags=_r0.M)
    return _r0.sub(r'\s+', ' ', s).strip()
def _legal_norm_html(fragment):
    s=_r0.sub(r'<[^>]+>', '', fragment)
    return _r0.sub(r'\s+', ' ', html.unescape(s)).strip()
def render_legal(md):
    lines=md.replace('\r\n', '\n').strip('\n').split('\n')
    out=[]
    i=0
    while i<len(lines):
        line=lines[i]
        if not line.strip():
            i+=1
            continue
        if line.startswith('## '):
            out.append(f'<h2>{_legal_inline(line[3:].strip())}</h2>')
            i+=1
            continue
        if line.startswith('# '):
            out.append(f'<h1>{_legal_inline(line[2:].strip())}</h1>')
            i+=1
            continue
        if line.startswith('- '):
            items=[]
            while i<len(lines) and lines[i].startswith('- '):
                items.append(f'<li>{_legal_inline(lines[i][2:].strip())}</li>')
                i+=1
            out.append('<ul>\n'+'\n'.join(items)+'\n</ul>')
            continue
        if _r0.match(r'\d+\. ', line):
            items=[]
            while i<len(lines) and _r0.match(r'\d+\. ', lines[i]):
                items.append(f'<li>{_legal_inline(_r0.sub(r"^\d+\. +", "", lines[i]).strip())}</li>')
                i+=1
            out.append('<ol>\n'+'\n'.join(items)+'\n</ol>')
            continue
        parts=[line.strip()]
        i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].startswith('#') and not lines[i].startswith('- ') and not _r0.match(r'\d+\. ', lines[i]):
            parts.append(lines[i].strip())
            i+=1
        inner='<br>\n'.join(_legal_inline(p) for p in parts)
        cls=' class="meta"' if parts[0].replace('**', '').lower().startswith('last updated') else ''
        out.append(f'<p{cls}>{inner}</p>')
    body='\n'.join(out)
    got, want=_legal_norm_html(body), _legal_norm_md(md)
    if got!=want:
        for i,(a,b) in enumerate(zip(got, want)):
            if a!=b:
                raise SystemExit('legal mismatch %s: %r vs %r'%(i, got[max(0,i-70):i+90], want[max(0,i-70):i+90]))
        raise SystemExit('legal mismatch length %s vs %s tail %r'%(len(got), len(want), (got[-80:], want[-80:])))
    return body
def write_doc(path, title, desc, body):
    node={"@type":"WebPage","@id":BASE+path,"url":BASE+path,"name":title,"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID}}
    page=head(title, desc, path, ld(node))+NAV+f'<main id="main" class="doc">\n{body}\n</main>\n'+foot()
    write(path+'.html', page)
TERMS_MD=open(SRC+'/legal/terms.md', encoding='utf-8').read()
PRIVACY_MD=open(SRC+'/legal/privacy.md', encoding='utf-8').read()
write_doc('/terms', 'Terms of Service | Get Seen Signs',
          'Terms of Service for orders placed with Get Seen Signs on getseensignsco.com.',
          render_legal(TERMS_MD))
write_doc('/privacy', 'Privacy Policy | Get Seen Signs',
          'How Get Seen Signs handles the information you share with us.',
          render_legal(PRIVACY_MD))
_sms,_wa,_tel=reach_links()
_call=f'<a class="btn btn-y btn-sm" href="{TEL_HREF}" aria-label="Call {PHONE_DISPLAY} to reach Get Seen Signs">Call {PHONE_DISPLAY}</a>'
_text=_sms.replace('<a ', '<a class="btn btn-ink btn-sm" ', 1)
_whats=_wa.replace('<a ', '<a class="btn btn-line btn-sm" ', 1)
CONTACT_BODY=f'''<h1>Contact</h1>
<p>Get Seen Signs</p>
<p>Smiths Station, AL</p>
<p><a href="mailto:sales@getseensignsco.com">sales@getseensignsco.com</a></p>
<p><a href="{TEL_HREF}" >{PHONE_DISPLAY}</a></p>
<div class="reach">
  <p class="reach-kicker">Text, WhatsApp or call</p>
  <div class="cta-row">{_text}{_whats}{_call}</div>
</div>
<p>For a price on a custom order, use the quote form.</p>
<p><a class="btn btn-ink" href="/#quote">Get a quote <span aria-hidden="true">→</span></a></p>'''
if 'Scott' in CONTACT_BODY or _r0.search(r'\b(Street|Avenue|Road|Lane|Drive|Blvd|Boulevard)\b', CONTACT_BODY):
    raise SystemExit('contact page has a personal name or a street address')
write_doc('/contact', 'Contact | Get Seen Signs',
          'Contact Get Seen Signs in Smiths Station, AL. Email sales@getseensignsco.com or call (334) 232-9003.',
          CONTACT_BODY)

# ---------- sitemap, robots ----------
LASTMOD={f'/blog/{b["slug"]}/':max(b['date'],TODAY) for b in BLOG}
LASTMOD['/blog/']=max([TODAY]+list(LASTMOD.values()))
LASTMOD['/terms']='2026-10-28'; LASTMOD['/contact']='2026-10-27'
LASTMOD['/privacy']='2026-10-28'
urls=['/','/shop/','/design/']+[f'/design/{d["slug"]}/' for d in DESIGN_PRODUCTS]+[f'/{p["slug"]}/' for p in P]+[f'/{L["slug"]}/' for L in LOCAL]+[f'/{GAMEDAY["slug"]}/']+['/blog/']+[f'/blog/{b["slug"]}/' for b in BLOG]+['/terms','/privacy','/contact']
sm='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{BASE}{u}</loc><lastmod>{LASTMOD.get(u,TODAY)}</lastmod></url>\n' for u in urls)+'</urlset>\n'
open(SITE+'/sitemap.xml','w').write(sm)
open(SITE+'/robots.txt','w').write(f'User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n')
# Single custom yard signs (Etsy 4597132396) were deactivated Oct 26, 2026. Packs of 5 are the minimum.
open(SITE+'/_redirects','w').write(
    '/custom-yard-signs /bulk-campaign-signs/ 301\n'
    '/custom-yard-signs/ /bulk-campaign-signs/ 301\n'
    '/custom-yard-signs/index.html /bulk-campaign-signs/ 301\n'
    # Vendor Booth Kit was retitled Trade Show Booth Kit on Etsy (Oct 28, 2026); the old path keeps working.
    '/vendor-booth-kit /trade-show-booth-kit/ 301\n'
    '/vendor-booth-kit/ /trade-show-booth-kit/ 301\n'
    '/vendor-booth-kit/index.html /trade-show-booth-kit/ 301\n'
)
json.dump(urls,open(SRC+'/urls.json','w'),indent=1)
print('pages:',len(urls))

# ---------- home page (main content from site-src-index.tpl.html) ----------
tpl=open(SRC+'/site-src-index.tpl.html').read()
main=tpl[tpl.index('<main id="main">'):tpl.index('</main>')+len('</main>')]
main=main.replace('fetchpriority="high"','fetchpriority="low" decoding="async"').replace('width="700" height="700">','width="700" height="700" fetchpriority="low" decoding="async">')
main=main.replace('src="assets/','src="/assets/').replace('srcset="assets/','srcset="/assets/')
main=main.replace('href="#quote"','href="#quote"')
SHORT={
 '02-bulk-yard-signs':('bulk-campaign-signs','5 to 100 packs for campaigns, crews and realtors. 5 is the minimum.'),
 '03-vinyl-banner':('vinyl-banners','13 oz, 18 oz heavy duty or mesh. Hemmed with grommets. 2×4 up to 3×10 ft.'),
 '04-feather-flag':('feather-flags','10.5, 14 or 18 ft. Pole, ground spike or cross base, and bag included.'),
 '05-retractable-banner':('retractable-banners','Pull-up stand. Sets up in 60 seconds.'),
 '06-car-magnet':('car-magnets','Vehicle-grade magnets for both doors.'),
 '07-real-estate-sign':('real-estate-signs','Coroplast or aluminum. Riders and post frames.'),
 '08-step-and-repeat':('step-and-repeat-backdrops','8×8 or 10×8 with stand and case.'),
 '09-table-throw':('table-throws','Throws or fitted covers for 6 or 8 ft tables.'),
 '10-canopy-tent':('custom-canopy-tents','Printed top and valance on a heavy-duty frame.'),
 '15-vendor-booth-kit':('trade-show-booth-kit','6 ft table throw, 33×81 banner and 10.5 ft flag. One price.'),
 '16-hard-hat-decals':('hard-hat-decals','Die-cut logo decals in 2 or 3 in. Packs of 100 to 500.'),
 '17-aluminum-safety-signs':('aluminum-safety-signs','Rust-proof aluminum, your logo and wording. 5 or 10 signs.'),
 '18-challenge-coins':('challenge-coins','1.75 in, full color on both sides. 50 or 100 coins.'),
 '19-custom-patches':('custom-patches','PVC or embroidered, with your logo. 50 or 100 patches.'),
 '11-christmas-family-banner':('holiday-yard-signs','Your family name, three classic styles.'),
 '12-senior-night-banner':('senior-night-banners','Photo, name and number. Team pricing for 10+.'),
 '14-thanksgiving-yard-sign':('holiday-yard-signs','Harvest or rustic, with your name.')}
NAMES={'02-bulk-yard-signs':'Bulk Yard Signs','03-vinyl-banner':'Vinyl Banner','04-feather-flag':'Feather Flag Kit','05-retractable-banner':'Retractable Banner','06-car-magnet':'Car Magnet Pair','07-real-estate-sign':'Real Estate Sign','08-step-and-repeat':'Step &amp; Repeat Backdrop','09-table-throw':'Table Throw','10-canopy-tent':'10×10 Canopy Tent','15-vendor-booth-kit':'Trade Show Booth Kit','16-hard-hat-decals':'Hard Hat Decals','17-aluminum-safety-signs':'Aluminum Safety Signs','18-challenge-coins':'Challenge Coins','19-custom-patches':'Custom Patches','11-christmas-family-banner':'Christmas Family Banner','12-senior-night-banner':'Senior Night Banner','14-thanksgiving-yard-sign':'Thanksgiving Yard Sign'}
def price_of(k):
    for p in P:
        if p.get('extra'):
            for x in p['extra']:
                if x['key']==k: return x['price'], 'each'
        if p['key']==k and not p.get('extra'): return p['price'], p['unit']
def hcard(k):
    slug,d=SHORT[k]; pr,u=price_of(k); n=NAMES[k]
    days=BY[slug]['days'] if slug in BY else '3-5'
    tag='<span class="tag">Ships in 5-10 days</span>' if (k in ('08-step-and-repeat','10-canopy-tent')) else ''
    price=f'<span class="price"><small>from</small> {money(pr)}<small class="unit"> {u}</small></span>' if pr else '<span class="price price-na">See price on Etsy</span>'
    alt=HERO_ALT.get(k, html.unescape(n)+" by Get Seen Signs")
    return f'''<a class="card" href="/{slug}/">
  <div class="card-img sq">{pic("/assets/img/p-"+k, alt, 1024, 1024, sm="/assets/img/p-"+k+"-sm", sizes="(max-width: 760px) 46vw, (max-width: 1180px) 30vw, 230px")}{tag}</div>
  <div class="card-body"><h3>{n}</h3><p>{d}</p>
  <div class="card-foot">{price}<span class="go">Sizes &amp; details <span aria-hidden="true">→</span></span></div></div>
</a>'''
BIZ_EXTRA={'15-vendor-booth-kit','16-hard-hat-decals','17-aluminum-safety-signs','18-challenge-coins','19-custom-patches'}
BIZK=[k for k in NAMES if int(k[:2])<=10 or k in BIZ_EXTRA]; SEAK=[k for k in NAMES if int(k[:2])>10 and k not in BIZ_EXTRA]
options=''.join(f'<option>{html.unescape(NAMES[k])}</option>' for k in NAMES)+'<option>Election / campaign signs</option><option>Birthday or graduation sign</option><option>Something else</option>'
REACH_HOME=f'''<div class="reach">
        <p class="reach-kicker">Text, WhatsApp or call</p>
        <div class="reach-row">
          <a class="btn btn-ink btn-sm" href="{SMS_HREF}" aria-label="Text us at {PHONE_DISPLAY}">Text us</a>
          <a class="btn btn-line btn-sm" href="{WA_HREF}" rel="noopener noreferrer" aria-label="Chat on WhatsApp with Get Seen Signs">Chat on WhatsApp</a>
        </div>
        <p class="mail">Call <a href="{TEL_HREF}" >{PHONE_DISPLAY}</a> · or email <a href="mailto:sales@getseensignsco.com">sales@getseensignsco.com</a></p>
      </div>'''
main=main.replace('{{BIZ}}','\n'.join(hcard(k) for k in BIZK)).replace('{{SEA}}','\n'.join(hcard(k) for k in SEAK)).replace('{{OPTIONS}}',options).replace('{{REACH}}',REACH_HOME)
LOCALSEC='''
<section class="sec paper2" id="local">
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">Close to home</p><h2>Based in Smiths Station. <span class="hl">Shipping everywhere.</span></h2>
    <p class="sub">We're a veteran-owned, family-run online sign shop in Lee County, Alabama, between Phenix City and Auburn. No storefront: everything ships free to your door.</p></div>
    <div class="local-grid">
      <a class="lcard" href="/signs-columbus-ga-phenix-city/"><h3>Columbus, GA &amp; Phenix City</h3><p>Campaign signs for the Dec 1 Georgia runoff, senior night banners, contractor magnets, and the local sign rules.</p><span class="go">Columbus &amp; Phenix City <span aria-hidden="true">→</span></span></a>
      <a class="lcard" href="/signs-auburn-opelika-al/"><h3>Auburn &amp; Opelika</h3><p>Tailgate tents, realtor signs, grand opening banners and booth displays for Lee County.</p><span class="go">Auburn &amp; Opelika <span aria-hidden="true">→</span></span></a>
      <a class="lcard" href="/tailgate-and-gameday-signs/"><h3>Tailgate &amp; gameday</h3><p>Tailgate tents, table throws, House Divided and Game Day yard signs in your colors.</p><span class="go">Gameday signs <span aria-hidden="true">→</span></span></a>
      <a class="lcard" href="/blog/christmas-family-name-banner-ideas/"><h3>Guide: Christmas sign ideas</h3><p>Family name banners and yard signs: what to print, which size fits where, and the Dec 10 order date.</p><span class="go">Read the guide <span aria-hidden="true">→</span></span></a>
      <a class="lcard" href="/blog/election-yard-sign-rules-alabama-georgia/"><h3>Guide: election sign rules</h3><p>Polling place distances, right-of-way rules and "paid for by" lines in Alabama and Georgia, with sources.</p><span class="go">Read the guide <span aria-hidden="true">→</span></span></a>
      <a class="lcard" href="/blog/senior-night-banner-ideas/"><h3>Guide: senior night ideas</h3><p>Layouts by sport, photo tips, sizes and when booster clubs should order.</p><span class="go">Read the guide <span aria-hidden="true">→</span></span></a>
    </div>
  </div>
</section>
'''
main=main.replace('<section class="final ink">',LOCALSEC+'<section class="final ink">')
main=main.replace('<h1>Signs that make people <span class="block">look twice.</span></h1>','<h1>Custom signs that make people <span class="block">look twice.</span></h1>')
import re as _re
home_faqs=[(html.unescape(_re.sub('<[^>]+>','',q)),a) for q,a in _re.findall(r'<details[^>]*><summary>(.*?)</summary><p>(.*?)</p></details>',main)]
title='Custom Yard Signs, Banners, Flags & Tents | Get Seen Signs'
desc='Custom yard signs, banners, feather flags, car magnets, backdrops and canopy tents. Free design proof, free shipping. Veteran-owned, Smiths Station, AL.'
page=head(title,desc,'/',ld({"@type":"WebPage","@id":BASE+"/","url":BASE+"/","name":title,"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID}},faqpage(home_faqs)))+NAV.replace('href="/#products"','href="#products"')+main+'\n'+foot()
write('/',page)

# ---------- shop page: every product with its "from" price and a way to order ----------
def shop_card(k):
    slug,d=SHORT[k]; pr,u=price_of(k); n=NAMES[k]
    alt=HERO_ALT.get(k, html.unescape(n)+" by Get Seen Signs")
    price=f'<span class="price"><small>from</small> {money(pr)}<small class="unit"> {u}</small></span>'
    return f'''<article class="card shop-card">
  <a class="card-img" href="/{slug}/" tabindex="-1" aria-hidden="true">{pic("/assets/img/p-"+k, alt, 1024, 1024, sm="/assets/img/p-"+k+"-sm", sizes="(max-width: 480px) 92vw, (max-width: 800px) 46vw, (max-width: 1100px) 30vw, 270px")}</a>
  <div class="card-body"><h3><a href="/{slug}/">{n}</a></h3><p>{d}</p>{price}
  <div class="shop-btns"><a class="btn btn-y btn-sm" href="/{slug}/#order" aria-label="Start my order: {e(html.unescape(n))}">Start my order</a><a class="more" href="/{slug}/">Details</a></div></div>
</article>'''
path='/shop/'; items=[('Home','/'),('Shop','/shop/')]
shop_title='Shop Custom Signs, Banners, Flags, Tents & More | Get Seen Signs'
shop_desc='Every Get Seen Signs product with its price: signs, banners, flags, tents, magnets, backdrops, decals, coins and patches. Free proof first, free shipping.'
shop_ld=[crumbs(items),{"@type":"CollectionPage","@id":BASE+path,"url":BASE+path,"name":shop_title,"description":shop_desc,"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID},
    "mainEntity":{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":i+1,"name":html.unescape(NAMES[k]),"url":BASE+"/"+SHORT[k][0]+"/"} for i,k in enumerate(BIZK+SEAK)]}}]
shop_page=head(shop_title,shop_desc,path,ld(*shop_ld))+NAV+f'''<main id="main">
<section class="phero ink">
  <div class="wrap">
    {bc_html(items)}
    <h1>Shop <span class="block">custom signs.</span></h1>
    <p class="lede">Pick a product, pick your size and quantity, and start your order. Proof first, then pay: we email your free proof within 12 hours, 7 days a week, and nothing is charged or printed until you approve it. Free shipping in the lower 48.</p>
    <div class="cta-row"><a class="btn btn-y" href="#business">Business, events &amp; teams</a><a class="btn btn-ghost" href="#seasonal">Seasonal &amp; personal</a><a class="btn btn-ghost" href="/#quote">Get a quote</a></div>
  </div>
</section>
<section class="sec paper">
  <div class="wrap">
    <h2 class="group" id="business">Business, events &amp; teams</h2>
    <div class="shop-grid">{''.join(shop_card(k) for k in BIZK)}</div>
    <h2 class="group" id="seasonal" style="margin-top:56px">Seasonal &amp; personal</h2>
    <div class="shop-grid">{''.join(shop_card(k) for k in SEAK)}</div>
  </div>
</section>
{quote_cta("Something else")}
</main>
'''+foot()
shop_page=shop_page.replace('</head>','<link rel="stylesheet" href="/assets/order/order.css">\n</head>',1)
write(path,shop_page)

# 404
nf=head('Page not found | Get Seen Signs','That page is not here. Browse custom signs, banners, flags and tents from Get Seen Signs.','/404.html','')
nf=nf.replace('<meta name="robots" content="index,follow,max-image-preview:large">','<meta name="robots" content="noindex">').replace('<link rel="canonical" href="'+BASE+'/404.html">\n','')
links=''.join(f'<a href="/{p["slug"]}/">{p["name"]}</a>' for p in P)
nf+=NAV+f'<main id="main"><section class="phero ink"><div class="wrap"><h1>Page not <span class="block">found.</span></h1><p class="lede">That page isn\'t here. Try one of these:</p><div class="cta-row"><a class="btn btn-y" href="/">Home</a><a class="btn btn-ghost" href="/design/">Design online</a><a class="btn btn-ghost" href="/#quote">Get a quote</a></div></div></section><section class="sec paper"><div class="wrap"><div class="link-cloud">{links}</div></div></section></main>'+foot()
open(SITE+'/404.html','w').write(nf)
print('home ok')
