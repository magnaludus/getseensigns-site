# Renders all SEO pages: product category pages, local landing pages, blog, sitemap.xml, robots.txt, 404.
# Content lives in seo_products.py (products + prices) and seo_pages.py (local pages + blog posts).
import json, html, os, sys, datetime, urllib.parse
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from seo_products import P, BY
from seo_pages import LOCAL, BLOG, GAMEDAY
SRC=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(SRC); SITE=ROOT  # repo root: built pages are written here
BASE='https://getseensignsco.com'
TODAY=datetime.date(2026,10,19).isoformat()
ETSY='https://www.etsy.com/shop/GetSeenSigns'
ORG_ID=BASE+'/#org'; SITE_ID=BASE+'/#website'
AREAS=['Columbus, GA','Phenix City, AL','Auburn, AL','Opelika, AL','Smiths Station, AL','Fort Benning, GA']
e=html.escape
import re as _r0
CSS=_r0.sub(r'\s*\n\s*','',open(SITE+'/assets/style.css').read()).replace('/*','\n/*')
CSS=_r0.sub(r'/\*.*?\*/','',CSS,flags=_r0.S)

def org():
    return {"@type":"Organization","@id":ORG_ID,"name":"Get Seen Signs","legalName":"Veracity Solutions LLC",
      "url":BASE+"/","logo":BASE+"/assets/brand/getseen-stacked-for-dark-bg.svg","image":BASE+"/assets/og-image.jpg",
      "email":"sales@getseensignsco.com",
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
# Free shipping lower 48 (shop-copy + product pages). Handling = site "days to make after proof"
# (seo_products days / product Turnaround). Transit = shop FAQ "Ground shipping takes 2–5 business days."
TRANSIT={"@type":"QuantitativeValue","minValue":2,"maxValue":5,"unitCode":"DAY"}
def shipping_details(days='3-5'):
    lo,hi=(5,10) if str(days).startswith('5') else (3,5)
    return {"@type":"OfferShippingDetails",
      "shippingRate":{"@type":"MonetaryAmount","value":"0","currency":"USD"},
      "shippingDestination":{"@type":"DefinedRegion","addressCountry":"US"},
      "deliveryTime":{"@type":"ShippingDeliveryTime",
        "handlingTime":{"@type":"QuantitativeValue","minValue":lo,"maxValue":hi,"unitCode":"DAY"},
        "transitTime":TRANSIT}}
def offer(price, etsy, desc, days='3-5'):
    return {"@type":"Offer","price":f"{price:.2f}","priceCurrency":"USD","availability":"https://schema.org/InStock",
            "url":f"https://www.etsy.com/listing/{etsy}","description":desc,"seller":{"@id":ORG_ID},
            "hasMerchantReturnPolicy":RETURNS,"shippingDetails":shipping_details(days)}
def product(name, desc, img, url, price, etsy, base, days='3-5'):
    d={"@type":"Product","name":name,"description":desc,"image":[BASE+i for i in img],"url":BASE+url,"brand":{"@type":"Brand","name":"Get Seen Signs"}}
    if price is not None: d["offers"]=offer(price, etsy, base, days)
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
      <a href="/#products">Products</a><a href="/signs-columbus-ga-phenix-city/">Columbus</a><a href="/signs-auburn-opelika-al/">Auburn</a><a href="/blog/">Guides</a><a href="/#faq">FAQ</a>
    </nav>
    <a class="btn btn-y btn-sm" href="/#quote">Get a quote</a>
  </div>
</header>
'''
def foot():
    prods=''.join(f'<a href="/{p["slug"]}/">{p["name"]}</a>' for p in P)
    return f'''<footer class="foot">
  <div class="wrap foot-in">
    <div>
      <img src="/assets/brand/getseen-stacked-for-dark-bg.svg" alt="Get Seen Signs" width="150" height="118" loading="lazy">
      <p class="foot-tag">Veteran-owned, family-run online sign shop. Smiths Station, Alabama. Shipping free across the lower 48.</p>
    </div>
    <div class="foot-cols">
      <div class="foot-prods"><p class="fh">Products</p>{prods}</div>
      <div><p class="fh">Local</p><a href="/signs-columbus-ga-phenix-city/">Columbus &amp; Phenix City</a><a href="/signs-auburn-opelika-al/">Auburn &amp; Opelika</a><a href="/tailgate-and-gameday-signs/">Tailgate &amp; gameday</a><p class="fh mt">Guides</p><a href="/blog/election-yard-sign-rules-alabama-georgia/">Election sign rules</a><a href="/blog/senior-night-banner-ideas/">Senior night ideas</a><a href="/blog/">All guides</a></div>
      <div><p class="fh">Shop</p><a href="{ETSY}" target="_blank" rel="noopener">Etsy shop</a><a href="/#quote">Get a quote</a><a href="mailto:sales@getseensignsco.com">sales@getseensignsco.com</a><a href="/#faq">FAQ</a><a href="/privacy">Privacy</a></div>
    </div>
  </div>
  <div class="wrap legal">
    <p>© <span id="yr">2026</span> Get Seen Signs. Get Seen Signs is a trade name of Veracity Solutions LLC.</p>
  </div>
</footer>
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
    return f'''<a class="card" href="/{p["slug"]}/">
  <div class="card-img">{pic("/assets/img/p-"+k, p["name"]+" by Get Seen Signs", 800, 600, sm="/assets/img/p-"+k+"-sm", sizes="(max-width: 760px) 46vw, (max-width: 1180px) 30vw, 260px")}</div>
  <div class="card-body"><h3>{p["name"]}</h3>
  <div class="card-foot">{pr}<span class="go">Sizes &amp; details <span aria-hidden="true">→</span></span></div></div>
</a>'''
def quote_cta(product_label, extra=''):
    q=html.escape(product_label)
    return f'''<section class="sec yellow cta-band">
  <div class="wrap cta-band-in">
    <div><p class="eyebrow">Free proof · free shipping</p><h2>Need a custom size, a rush or a big order?</h2><p>Tell us what you need and we'll reply with a price and next steps, usually within 1 business day.{extra}</p></div>
    <div class="cta-row"><a class="btn btn-ink" href="/?product={urllib.parse.quote_plus(product_label)}#quote">Get a quote <span aria-hidden="true">→</span></a><a class="btn btn-line" href="mailto:sales@getseensignsco.com?subject={urllib.parse.quote('Quote: '+product_label)}">Email us</a></div>
  </div>
</section>'''
def write(path, s):
    full=SITE+path+('index.html' if path.endswith('/') else '')
    os.makedirs(os.path.dirname(full), exist_ok=True); open(full,'w').write(s)

# ---------- product pages ----------
ALT2={ # alt text for the in-use example photo (2.jpg) and close-up (3.jpg) per listing
 '01-custom-yard-sign':('Example 18×24 custom yard sign for a lawn care business on a metal H-stake','Close-up of a coroplast yard sign on its wire H-stake in grass'),
 '02-bulk-yard-signs':('Stack of printed campaign yard signs for a school board race','Bundle of metal H-stakes on a stack of coroplast signs'),
 '03-vinyl-banner':('Yellow Now Open vinyl banner hung outside a hardware store','Close-up of a hemmed vinyl banner edge with a metal grommet and tie'),
 '04-feather-flag':('Two red Sale feather flags in a parking lot','Close-up of a feather flag sleeve on its pole'),
 '05-retractable-banner':('Retractable banner stand for a dental office at an event','Retractable banner base with the print rolled out of the aluminum cassette'),
 '06-car-magnet':('Custom car door magnet for a plumbing company on a van','Hand peeling back the corner of a rounded car magnet'),
 '07-real-estate-sign':('For sale real estate sign with an Open House rider in a front yard','Close-up of a real estate sign hanging from a post frame'),
 '08-step-and-repeat':('Guests posing in front of a step and repeat logo backdrop at a gala','Close-up of a step and repeat backdrop on its telescoping stand'),
 '09-table-throw':('Green logo table throw on a farmers market vendor table','Close-up of the corner of a fitted table throw'),
 '10-canopy-tent':('Orange custom 10×10 canopy tent with a printed valance at an outdoor event','Close-up of a canopy tent leg and printed top corner'),
 '11-christmas-family-banner':('Red Merry Christmas family name banner on a porch rail','Close-up of a red vinyl banner tied to a porch rail with grommets'),
 '12-senior-night-banner':('Navy senior night banner with name, number and class year on a ballfield fence','Close-up of a vinyl banner zip-tied to a chain-link fence through grommets'),
 '13-halloween-yard-sign':('Happy Halloween family name yard sign with pumpkins',None),
 '14-thanksgiving-yard-sign':('Give Thanks family name yard sign with fall pumpkins',None),
}
for p in P:
    path=f'/{p["slug"]}/'; k=p['key']; items=[('Home','/'),(p['name'],path)]
    imgs=[f'/assets/img/p-{k}.jpg', f'/assets/img/g-{k}-2.jpg']
    if p.get('extra'):
        nodes=[product(x['name'], p['desc'], [f'/assets/img/p-{x["key"]}.jpg'], path, x['price'], x['etsy'], x['base'], p['days']) for x in p['extra']]
    else:
        nodes=[product(p['name'], p['desc'], imgs, path, p['price'], p['etsy'], p['base'], p['days'])]
    nodes+= [crumbs(items), faqpage(p['faqs']), {"@type":"WebPage","@id":BASE+path,"url":BASE+path,"name":p['title'],"isPartOf":{"@id":SITE_ID},"about":{"@id":ORG_ID}}]
    if p['price']:
        price_html=f'<p class="pp"><span class="price"><small>from</small> {money(p["price"])}<small class="unit"> {p["unit"]}</small></span><span class="pp-note">{e(p["base"]) or "Starting price"} · free shipping, lower 48</span></p>'
    else:
        price_html='<p class="pp"><span class="pp-note">Pricing is being updated. See the current price on Etsy, or get a quote.</span></p>'
    days='5–10' if p['days']=='5-10' else '3–5'
    spec=f'''<dl class="spec">
<div><dt>Sizes</dt><dd>{"<br>".join(e(s) for s in p["sizes"])}</dd></div>
<div><dt>Material</dt><dd>{e(p["material"])}</dd></div>
<div><dt>Included</dt><dd>{e(p["included"])}</dd></div>
<div><dt>Turnaround</dt><dd>{days} business days to make after you approve your proof, plus shipping. Rush on request.</dd></div>
<div><dt>Proof</dt><dd>Free digital proof within 1 business day, 2 revisions included. Nothing prints until you approve.</dd></div>
<div><dt>Shipping</dt><dd>Free in the lower 48</dd></div>
<div><dt>Your artwork</dt><dd>Logos, photos and text you send are your responsibility. You confirm you have the right to use them. We don't print team, school or league names, logos or slogans.</dd></div>
</dl>'''
    a2,a3=ALT2[k]
    gal=[(f'/assets/img/g-{k}-2',a2)]
    if a3 and os.path.exists(f'{SITE}/assets/img/g-{k}-3.webp'): gal.append((f'/assets/img/g-{k}-3',a3))
    if p.get('extra'):
        gal=[(f'/assets/img/g-{x["key"]}-2',ALT2[x['key']][0]) for x in p['extra']]
    gal_html='<div class="gal">'+''.join(f'<figure>{pic(b,a,900,675,sm=b+"-sm")}<figcaption>Example design</figcaption></figure>' for b,a in gal)+'</div>'
    body=''.join(f'<h2>{e(h)}</h2><p>{t}</p>' for h,t in p['body'])
    if p.get('extra'):
        buy='<div class="buy-list">'+''.join(f'<a class="buy" href="https://www.etsy.com/listing/{x["etsy"]}" target="_blank" rel="noopener"><span><b>{e(x["name"])}</b><small>{e(x["base"])}</small></span><span class="price"><small>from</small> {money(x["price"])}</span><span class="go">Etsy <span aria-hidden="true">→</span></span></a>' for x in p['extra'])+'</div>'
        etsy_btn=f'<a class="btn btn-y" href="#buy">Shop the designs <span aria-hidden="true">↓</span></a>'
    else:
        buy=''
        etsy_btn=f'<a class="btn btn-y" href="https://www.etsy.com/listing/{p["etsy"]}" target="_blank" rel="noopener">Order on Etsy <span aria-hidden="true">→</span></a>'
    rel=''.join(card(BY[s]) for s in p['related'])
    hero_img=pic(f'/assets/img/p-{k}', f'{p["name"]} by Get Seen Signs', 800, 600, eager=True)
    page=head(p['title'],p['desc'],path,ld(*nodes),og_img=f'/assets/img/g-{k}-2.jpg',og_w=900,og_h=675,otype='product',preload=f'/assets/img/p-{k}.webp')+NAV+f'''<main id="main">
<section class="phero ink">
  <div class="wrap">
    {bc_html(items)}
    <div class="phero-in">
      <div>
        <h1>{e(p["h1"][0])} <span class="block">{e(p["h1"][1])}</span></h1>
        <p class="lede">{e(p["lede"])}</p>
        {price_html}
        <div class="cta-row">{etsy_btn}<a class="btn btn-ghost" href="/?product={urllib.parse.quote_plus(p["short"])}#quote">Get a quote</a></div>
      </div>
      <figure class="phero-img">{hero_img}</figure>
    </div>
  </div>
</section>
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
    og='/assets/img/g-02-bulk-yard-signs-2.jpg' if 'election' in b['slug'] else '/assets/img/g-12-senior-night-banner-2.jpg'
    art={"@type":"BlogPosting","headline":b['h1'],"description":b['desc'],"datePublished":b['date'],"dateModified":TODAY,"inLanguage":"en-US",
         "author":{"@id":ORG_ID},"publisher":{"@id":ORG_ID},"mainEntityOfPage":BASE+path,"image":BASE+og}
    nodes=[art, crumbs(items)]
    img=pic(og[:-4],'Example campaign yard signs stacked for a school board race' if 'election' in b['slug'] else 'Example senior night banner on a ballfield fence',900,675,eager=True)
    page=head(b['title'],b['desc'],path,ld(*nodes),og_img=og,og_w=900,og_h=675,otype='article',preload=og[:-4]+'.webp')+NAV+f'''<main id="main">
<article>
<section class="phero ink">
  <div class="wrap">
    {bc_html(items)}
    <div class="phero-in">
      <div>
        <p class="eyebrow">{e(b["kicker"])} · <time datetime="{b["date"]}">October 17, 2026</time></p>
        <h1 class="h1-post">{e(b["h1"])}</h1>
        <p class="lede">{e(b["lede"])}</p>
      </div>
      <figure class="phero-img">{img}</figure>
    </div>
  </div>
</section>
<section class="sec paper"><div class="wrap prose">{b["html"]}</div></section>
</article>
{quote_cta("Bulk Yard Signs" if "election" in b["slug"] else "Senior Night Banner")}
</main>
'''+foot()
    write(path,page)
    posts_cards+=f'<a class="post" href="{path}"><div class="card-img">{pic(og[:-4],"",900,675)}</div><div class="card-body"><p class="eyebrow">{e(b["kicker"])}</p><h3>{e(b["h1"])}</h3><p>{e(b["desc"])}</p><span class="go">Read the guide <span aria-hidden="true">→</span></span></div></a>'
path='/blog/'; items=[('Home','/'),('Guides','/blog/')]
title='Sign Guides & How-Tos | Get Seen Signs'
desc='Practical guides from Get Seen Signs: Alabama and Georgia election yard sign rules, senior night banner ideas, and how to pick the right sign.'
page=head(title,desc,path,ld(crumbs(items),{"@type":"Blog","@id":BASE+path,"url":BASE+path,"name":"Get Seen Signs Guides","publisher":{"@id":ORG_ID}}))+NAV+f'''<main id="main">
<section class="phero ink"><div class="wrap">{bc_html(items)}<h1>Sign <span class="block">guides.</span></h1><p class="lede">Straight answers for people buying signs: the rules, the sizes and the timing.</p></div></section>
<section class="sec paper"><div class="wrap"><div class="posts">{posts_cards}</div></div></section>
</main>
'''+foot()
write(path,page)

# ---------- sitemap, robots ----------
urls=['/']+[f'/{p["slug"]}/' for p in P]+[f'/{L["slug"]}/' for L in LOCAL]+[f'/{GAMEDAY["slug"]}/']+['/blog/']+[f'/blog/{b["slug"]}/' for b in BLOG]+['/privacy']
sm='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{BASE}{u}</loc><lastmod>{TODAY}</lastmod></url>\n' for u in urls)+'</urlset>\n'
open(SITE+'/sitemap.xml','w').write(sm)
open(SITE+'/robots.txt','w').write(f'User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n')
json.dump(urls,open(SRC+'/urls.json','w'),indent=1)
print('pages:',len(urls))

# ---------- home page (main content from site-src-index.tpl.html) ----------
tpl=open(SRC+'/site-src-index.tpl.html').read()
main=tpl[tpl.index('<main id="main">'):tpl.index('</main>')+len('</main>')]
main=main.replace('fetchpriority="high"','fetchpriority="low" decoding="async"').replace('width="700" height="700">','width="700" height="700" fetchpriority="low" decoding="async">')
main=main.replace('src="assets/','src="/assets/').replace('srcset="assets/','srcset="/assets/')
main=main.replace('href="#quote"','href="#quote"')
SHORT={'01-custom-yard-sign':('custom-yard-signs','18×24 or 24×36 coroplast, H-stake included.'),
 '02-bulk-yard-signs':('bulk-campaign-signs','5 to 100 packs for campaigns, crews and realtors.'),
 '03-vinyl-banner':('vinyl-banners','13 oz outdoor vinyl, hemmed with grommets. 2×4 up to 3×10 ft.'),
 '04-feather-flag':('feather-flags','10, 12 or 15 ft. Pole, base and bag included.'),
 '05-retractable-banner':('retractable-banners','Pull-up stand. Sets up in 60 seconds.'),
 '06-car-magnet':('car-magnets','Vehicle-grade magnets for both doors.'),
 '07-real-estate-sign':('real-estate-signs','Coroplast or aluminum. Riders and post frames.'),
 '08-step-and-repeat':('step-and-repeat-backdrops','8×8 or 10×8 with stand and case.'),
 '09-table-throw':('table-throws','Fits 6 or 8 ft tables. Washable, wrinkle resistant.'),
 '10-canopy-tent':('custom-canopy-tents','Printed top and valance on a heavy-duty frame.'),
 '11-christmas-family-banner':('holiday-yard-signs','Your family name, three classic styles.'),
 '12-senior-night-banner':('senior-night-banners','Photo, name and number. Team pricing for 10+.'),
 '13-halloween-yard-sign':('holiday-yard-signs','Family-name sign with stake.'),
 '14-thanksgiving-yard-sign':('holiday-yard-signs','Harvest or rustic, with your name.')}
NAMES={'01-custom-yard-sign':'Custom Yard Sign','02-bulk-yard-signs':'Bulk Yard Signs','03-vinyl-banner':'Vinyl Banner','04-feather-flag':'Feather Flag Kit','05-retractable-banner':'Retractable Banner','06-car-magnet':'Car Magnet Pair','07-real-estate-sign':'Real Estate Sign','08-step-and-repeat':'Step &amp; Repeat Backdrop','09-table-throw':'Table Throw','10-canopy-tent':'10×10 Canopy Tent','11-christmas-family-banner':'Christmas Family Banner','12-senior-night-banner':'Senior Night Banner','13-halloween-yard-sign':'Halloween Yard Sign','14-thanksgiving-yard-sign':'Thanksgiving Yard Sign'}
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
    return f'''<a class="card" href="/{slug}/">
  <div class="card-img">{pic("/assets/img/p-"+k, html.unescape(n)+" by Get Seen Signs", 800, 600, sm="/assets/img/p-"+k+"-sm", sizes="(max-width: 760px) 46vw, (max-width: 1180px) 30vw, 230px")}{tag}</div>
  <div class="card-body"><h3>{n}</h3><p>{d}</p>
  <div class="card-foot">{price}<span class="go">Sizes &amp; details <span aria-hidden="true">→</span></span></div></div>
</a>'''
BIZK=[k for k in NAMES if int(k[:2])<=10]; SEAK=[k for k in NAMES if int(k[:2])>10]
options=''.join(f'<option>{html.unescape(NAMES[k])}</option>' for k in NAMES)+'<option>Election / campaign signs</option><option>Birthday or graduation sign</option><option>Something else</option>'
main=main.replace('{{BIZ}}','\n'.join(hcard(k) for k in BIZK)).replace('{{SEA}}','\n'.join(hcard(k) for k in SEAK)).replace('{{OPTIONS}}',options)
main=main.replace('Every price includes a free custom design proof and free shipping in the lower 48. Tap a product to order on Etsy.','Every price includes a free custom design proof and free shipping in the lower 48. Tap a product for sizes, materials and FAQs, then order on Etsy or get a quote.')
LOCALSEC='''
<section class="sec paper2" id="local">
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">Close to home</p><h2>Based in Smiths Station. <span class="hl">Shipping everywhere.</span></h2>
    <p class="sub">We're a veteran-owned, family-run online sign shop in Lee County, Alabama, between Phenix City and Auburn. No storefront: everything ships free to your door.</p></div>
    <div class="local-grid">
      <a class="lcard" href="/signs-columbus-ga-phenix-city/"><h3>Columbus, GA &amp; Phenix City</h3><p>Campaign signs for the Dec 1 Georgia runoff, senior night banners, contractor magnets, and the local sign rules.</p><span class="go">Columbus &amp; Phenix City <span aria-hidden="true">→</span></span></a>
      <a class="lcard" href="/signs-auburn-opelika-al/"><h3>Auburn &amp; Opelika</h3><p>Tailgate tents, realtor signs, grand opening banners and booth displays for Lee County.</p><span class="go">Auburn &amp; Opelika <span aria-hidden="true">→</span></span></a>
      <a class="lcard" href="/tailgate-and-gameday-signs/"><h3>Tailgate &amp; gameday</h3><p>Tailgate tents, table throws, House Divided and Game Day yard signs in your colors.</p><span class="go">Gameday signs <span aria-hidden="true">→</span></span></a>
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

# 404
nf=head('Page not found | Get Seen Signs','That page is not here. Browse custom signs, banners, flags and tents from Get Seen Signs.','/404.html','')
nf=nf.replace('<meta name="robots" content="index,follow,max-image-preview:large">','<meta name="robots" content="noindex">').replace('<link rel="canonical" href="'+BASE+'/404.html">\n','')
links=''.join(f'<a href="/{p["slug"]}/">{p["name"]}</a>' for p in P)
nf+=NAV+f'<main id="main"><section class="phero ink"><div class="wrap"><h1>Page not <span class="block">found.</span></h1><p class="lede">That page isn\'t here. Try one of these:</p><div class="cta-row"><a class="btn btn-y" href="/">Home</a><a class="btn btn-ghost" href="/#quote">Get a quote</a></div></div></section><section class="sec paper"><div class="wrap"><div class="link-cloud">{links}</div></div></section></main>'+foot()
open(SITE+'/404.html','w').write(nf)
print('home ok')
