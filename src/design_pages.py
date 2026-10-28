# Copy for the online designer pages: /design/ and one page per product. Facts (sizes, options,
# prices) come from seo_products.py and design_catalog.json at build time, so nothing here can drift.
# No Product or Offer schema on these pages: the product pages keep the Offers.
from seo_products import BY

PROOF = 'a free proof within 12 hours, 7 days a week, with 3 revisions included'

HUB = {
    'title': 'Design Your Sign Online | Get Seen Signs',
    'desc': 'Design a canopy tent, feather flag, yard sign, table throw, banner, retractable stand, backdrop, car magnet, hard hat decal or safety sign online. See it in 3D, then get your free proof within 12 hours.',
    'h1': ("Design it here.", "We'll proof it."),
    'lede': 'Pick a product, add your words, colors and logo, turn it around in 3D, and send it. We turn it into a real proof within 12 hours.',
    'faqs': [
        ('Is this preview the file you print?', 'No. It shows your words, colors and logo on the product. We build the real print file during your free proof. Nothing prints until you approve.'),
        ('How fast is the free proof?', 'You get a free digital proof within 12 hours, 7 days a week, with 3 revisions included.'),
        ('Which products can I design here?', 'A 10×10 canopy tent, feather flags in 10.5, 14 and 18 ft, 18×24 yard signs sold in packs of 5 or more, 6 ft and 8 ft table throws, vinyl banners in 13 oz, 18 oz and mesh, retractable banner stands, step and repeat backdrops, car magnets, hard hat decals and aluminum safety sign packs. Challenge coins and the trade show booth kit start from the logo you send us.'),
        ('Do I need an account?', 'No. There is nothing to sign up for. You only share your name and email when you ask for your proof.'),
        ('What happens to my logo?', 'It stays on your device while you design. It is sent to us only when you send your proof request. We use what you send only to make your proof.'),
        ('Can I see it in 3D?', 'Yes. Switch from Flat to 3D to turn the product around. If 3D does not work on your device, you get a simple picture instead and can still design and send your proof.'),
    ],
}

# slug -> page data. `id` is the product id in design_catalog.json, `page` the product page slug in seo_products.py.
PRODUCTS = [
    {
        'id': 'canopy', 'slug': 'canopy-tent', 'page': 'custom-canopy-tents', 'name': '10×10 canopy tent', 'short': 'canopy tent',
        'title': 'Design a 10x10 Canopy Tent Online in 3D | Get Seen Signs',
        'desc': 'Design your 10×10 canopy tent online. Pick a layout, add your name, colors and logo, spin it around in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your canopy tent.', "We'll proof it."),
        'lede': 'Pick a layout, add your name and logo, and turn your 10×10 tent around in 3D before you send it. Free design proof within 12 hours, 7 days a week.',
        'alt': 'A printed 10×10 canopy tent with a custom top and valance',
        'sections': [
            ('What you can design', 'Your tent has a roof peak and a valance on all four sides. Put the same design on every side, or choose Each side different and design the front, right, back and left one at a time. Pick the standard top and valance, top with back wall, or the full kit. The designer covers the printed top and valance. Walls, the flag and the table throw in the full kit are laid out on your free proof.'),
            ('How the designer works', 'Start from one of four layouts, then change the words, colors and font, and add your logo as a PNG, JPG, WebP or SVG. Drag, resize and rotate anything on the flat view, then switch to 3D and walk around the tent to check every side. Guides show the roof shape, the valance line and a safe zone so your name does not land where it could be trimmed.'),
            ('What it costs', 'Tents start at {price} with free shipping in the lower 48. The price you see in the designer is the price for the package you choose.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Tents arrive 5 to 10 business days after you approve.'),
        ],
        'faqs': [
            ('Can each side of the tent be different?', 'Yes. Choose Each side different in the Sides tab, then design the front, right, back and left sides one at a time. You can also copy one side onto the others.'),
            ('Is the preview the file you print?', 'No. It shows your words, colors and logo on the tent. We build the real print file during your free proof, and nothing prints until you approve it.'),
            ('Do I have to upload a logo?', 'No. Start with words and colors, and tell us what you have when you send your proof request.'),
        ],
    },
    {
        'id': 'feather', 'slug': 'feather-flag', 'page': 'feather-flags', 'name': 'feather flag', 'short': 'feather flag',
        'title': 'Design a Feather Flag Online with 3D Preview | Get Seen Signs',
        'desc': 'Design a 10.5, 14 or 18 ft feather flag online. Add your words, colors and logo, see it in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your feather flag.', "We'll proof it."),
        'lede': 'Big letters, one clear message. Design a 10.5, 14 or 18 ft feather flag and see it in 3D before you send it.',
        'alt': 'A custom printed feather flag on a pole',
        'sections': [
            ('What you can design', 'Choose a 10.5, 14 or 18 ft flag and a ground spike or a cross base. Flags are tall and narrow, so the layouts use big stacked words or one long name running up the flag. Add your logo, change the colors, and the designer warns you when text is too small to read from a distance.'),
            ('How the designer works', 'Pick a layout, type your business name, and change anything you like. Drag, resize and rotate text and shapes on the flat view. Switch to 3D to see the flag on its pole, then send it. A guide shows the flag shape and the pole sleeve edge, so you can see what stays clear of the seam.'),
            ('What it costs', 'Feather flag kits start at {price} with free shipping in the lower 48. Your price updates as you pick a height and a base, and it matches our Etsy listing.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Flags arrive 3 to 8 business days after you approve.'),
        ],
        'faqs': [
            ('Which sizes can I design?', 'The 10.5, 14 and 18 ft flag kits. Each one has a ground spike or a cross base to choose from.'),
            ('Will people read it from the road?', 'The designer checks letter height against a readable minimum for flags and shows a note when text is too small. Short words in big letters work best.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'yard', 'slug': 'yard-signs', 'page': 'bulk-campaign-signs', 'name': 'yard sign pack', 'short': 'yard signs',
        'title': 'Design Yard Sign Packs Online with 3D Preview | Get Seen Signs',
        'desc': 'Design a pack of 18×24 yard signs online. Choose 5 to 100 signs, one or two sides, see them in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your yard signs.', "We'll proof it."),
        'lede': 'Design one sign and we print the whole pack. Choose 5 to 100 signs, one side or two, and see it standing in a yard in 3D.',
        'alt': 'Custom printed yard signs with metal stakes',
        'sections': [
            ('What you can design', 'Choose a pack of 5, 10, 25, 50 or 100 18×24 yard signs, printed on one side or two. Every sign comes with a metal H-stake. Pick a layout, add the name or message, the phone number and a logo, and every sign in the pack gets your design.'),
            ('How the designer works', 'Start from one of four layouts and change the words and colors. Yard signs are read from a car, so the designer checks that your main words are big enough and keeps everything inside a safe margin. For two-sided packs you can use the same design on both sides or design the front and back separately.'),
            ('What it costs', 'Packs start at {price} for 5 signs, stakes included, with free shipping in the lower 48. Your price updates as you pick a pack size and one or two sides, and it matches our Etsy listing.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Signs arrive 3 to 8 business days after you approve.'),
        ],
        'faqs': [
            ('Can I print both sides?', 'Yes. Choose two sides, then use the same design on both or design the front and back separately.'),
            ('Is there a minimum order?', 'Packs start at 5 signs. Choose 5, 10, 25, 50 or 100.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'throw', 'slug': 'table-throw', 'page': 'table-throws', 'name': 'table throw', 'short': 'table throw',
        'title': 'Design a Custom Table Throw Online in 3D | Get Seen Signs',
        'desc': 'Design a 6 or 8 ft table throw online. Add your logo and colors, see it on a table in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your table throw.', "We'll proof it."),
        'lede': 'Turn a folding table into a booth. Design a 6 or 8 ft throw with your logo and see it on a table in 3D.',
        'alt': 'A custom printed table throw on a folding table',
        'sections': [
            ('What you can design', 'Pick a 6 ft or 8 ft table and a 3-sided style (open back), a 4-sided style that covers all the way around, or a fitted cover that is closed on the back. Your design goes on the front panel, which is the part customers see from the aisle. Layouts put your name wide and low so it reads over a crowd.'),
            ('How the designer works', 'Choose a layout, type your name, and add your logo. The front panel is long and short, so the designer keeps your words big and inside a safe margin. Switch to 3D to see the cover on a table and walk around the back to see the open or closed style.'),
            ('What it costs', 'Table throws start at {price} with free shipping in the lower 48. Your price updates as you pick a length and a style, and it matches our Etsy listing.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Throws arrive 3 to 8 business days after you approve.'),
        ],
        'faqs': [
            ('Where does my design go?', 'On the front panel. We lay out the rest of the cover with you on your free proof.'),
            ('What is the difference between 3-sided and 4-sided?', 'A 3-sided throw has an open back. A 4-sided throw covers the back as well.'),
            ('What is a fitted cover?', 'A fitted cover is tailored to the table and closed on the back. You design the front panel, and the 3D preview shows it like a 3-sided throw.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'banner', 'slug': 'vinyl-banner', 'page': 'vinyl-banners', 'name': 'vinyl banner', 'short': 'vinyl banner',
        'title': 'Design a Vinyl Banner Online with 3D Preview | Get Seen Signs',
        'desc': 'Design a 2×4, 3×6, 4×8 or 3×10 ft vinyl banner in 13 oz, 18 oz or mesh. See it on a fence or wall in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your vinyl banner.', "We'll proof it."),
        'lede': 'Grand opening, sale, ball season. Design a vinyl banner with your words and logo and see it hung up in 3D.',
        'alt': 'A custom printed vinyl banner with grommets',
        'sections': [
            ('What you can design', 'Choose 2×4, 3×6, 4×8 or 3×10 ft, in 13 oz standard, 18 oz heavy duty or mesh wind-through vinyl. Banners have hemmed edges and metal grommets. The designer shows where the grommets and hems fall and keeps a safe margin, so your words stay clear of the edges.'),
            ('How the designer works', 'Pick a layout, type your headline and the details, and add a logo. Drag and resize anything on the flat view, and check readability: the designer warns you when letters are too small to read from across a parking lot. Switch to 3D to see the banner on a fence or a wall.'),
            ('What it costs', 'Banners start at {price} with free shipping in the lower 48. Your price updates as you pick a size, and it matches our Etsy listing.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Banners arrive 3 to 8 business days after you approve.'),
        ],
        'faqs': [
            ('Where do the grommets go?', 'The designer shows grommet spots and a safe zone so your words stay clear of the hems. You can ask for pole pockets instead of grommets when you send your proof request.'),
            ('Which sizes and materials can I design?', '2×4, 3×6, 4×8 and 3×10 ft, in 13 oz standard, 18 oz heavy duty or mesh wind-through.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'retractable', 'slug': 'retractable-banner', 'page': 'retractable-banners', 'name': 'retractable banner stand', 'short': 'retractable banner',
        'title': 'Design a Retractable Banner Stand Online | Get Seen Signs',
        'desc': 'Design a 33×81 or 47×81 retractable banner stand online. Add your words, colors and logo, see it in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your retractable banner.', "We'll proof it."),
        'lede': 'Your logo and message on a pull-up stand that sets up in 60 seconds. Design a 33×81 or 47×81 banner and see it in 3D before you send it.',
        'alt': 'A custom printed retractable banner stand',
        'sections': [
            ('What you can design', 'Choose the 33×81 or the 47×81 stand. The designer shows the trim line, the bleed and a safe zone, plus a stand zone near the bottom. About the bottom 10 inches often sit behind tables and feet, so keep names and phone numbers above that line.'),
            ('How the designer works', 'Pick one of four tall layouts, change the words, colors and font, and add your logo as a PNG, JPG, WebP or SVG. Drag, resize and rotate anything on the flat view, then switch to 3D to see the stand. The designer warns you when a logo is too low in resolution for the size.'),
            ('What it costs', 'Retractable banners start at {price} with free shipping in the lower 48. The price you see in the designer matches our Etsy listing for the size you pick.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Banners arrive 3 to 8 business days after you approve.'),
        ],
        'faqs': [
            ('Does the price include the stand?', 'Yes. The price includes the aluminum base, the printed banner, the pole and a padded bag.'),
            ('Why is there a line near the bottom of the banner?', 'The bottom of a pull-up banner goes into the base and often sits behind tables. The line shows where to stop putting names and phone numbers.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'backdrop', 'slug': 'step-and-repeat', 'page': 'step-and-repeat-backdrops', 'name': 'step and repeat backdrop', 'short': 'step and repeat backdrop',
        'title': 'Design a Step and Repeat Backdrop Online | Get Seen Signs',
        'desc': 'Design an 8×8 or 10×8 ft step and repeat backdrop online. Repeat your logo and name, see it in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your step and repeat.', "We'll proof it."),
        'lede': 'A logo wall for galas, proms, banquets and grand openings. Repeat your logo and name, check it in 3D, and send it for your free proof.',
        'alt': 'A step and repeat backdrop on a telescoping stand',
        'sections': [
            ('What you can design', 'Choose 8×8 ft or 10×8 ft (width by height). The layouts repeat your name and logo in rows so a logo lands beside every face in a photo. Add several logos if sponsors share the wall.'),
            ('How the designer works', 'Start from a repeating layout, change the words, colors and font, and add your logo. Copy, drag and resize the repeats on the flat view, then switch to 3D to see the backdrop on its stand. Guides show the trim, the bleed and a safe zone.'),
            ('What it costs', 'Backdrops start at {price} with the stand and case, and free shipping in the lower 48. The price you see in the designer matches our Etsy listing for the size you pick.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Backdrops arrive 5 to 10 business days after you approve.'),
        ],
        'faqs': [
            ('Is the stand included?', 'Yes. The price includes the telescoping stand and a carry case.'),
            ('Can sponsor logos be included?', 'Yes. Add every logo you need in the designer, and tell us which one leads when you send your proof request.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'magnet', 'slug': 'car-magnet', 'page': 'car-magnets', 'name': 'car magnet pair', 'short': 'car magnet',
        'title': 'Design Custom Car Magnets Online | Get Seen Signs',
        'desc': 'Design a pair of 12×18 or 18×24 car door magnets online. Add your name, phone and logo, see it in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your car magnets.', "We'll proof it."),
        'lede': 'Your business name and phone number on both doors. Design a 12×18 or 18×24 pair and see it on a door panel in 3D.',
        'alt': 'A custom printed car door magnet',
        'sections': [
            ('What you can design', 'Choose 12×18 or 18×24 inches. A pair is two magnets with the same design, one for each door. The designer keeps your words inside a safe zone away from the rounded corners.'),
            ('How the designer works', 'Pick a layout, type your name, what you do and your phone number, and add a logo. Keep it short and big: it is read in traffic. The designer warns you when letters are too small to read from a few car lengths back.'),
            ('What it costs', 'A pair starts at {price} with free shipping in the lower 48. The price you see in the designer matches our Etsy listing for the size you pick.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Magnets arrive 3 to 8 business days after you approve. Measure the flat steel part of your door before you order.'),
        ],
        'faqs': [
            ('Is the price for one magnet or two?', 'Two. Car magnets are sold as a pair, and both get the same design.'),
            ('Will a magnet stick to my vehicle?', 'Only to flat steel panels. Test with a fridge magnet first. Many newer trucks use aluminum panels, and magnets will not stick to those.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'decal', 'slug': 'hard-hat-decal', 'page': 'hard-hat-decals', 'name': 'hard hat decal', 'short': 'hard hat decal',
        'title': 'Design Custom Hard Hat Decals Online | Get Seen Signs',
        'desc': 'Design 2 or 3 inch hard hat decals online in packs of 100 to 500. Add your logo and name, see it on a hard hat in 3D, then get a free proof within 12 hours.',
        'h1': ('Design your hard hat decals.', "We'll proof it."),
        'lede': 'Your logo on every helmet in the crew. Design a 2 or 3 inch decal and see it on a hard hat in 3D before you send it.',
        'alt': 'A custom die-cut decal on a white hard hat',
        'sections': [
            ('What you can design', 'Choose 2 inch or 3 inch (measured on the longest side) and a pack of 100, 250 or 500. Decals are die cut to the shape of your logo, which we set up on your proof, so the designer shows a square preview of the art.'),
            ('How the designer works', 'Start from a layout, add your logo as a PNG, JPG, WebP or SVG, and change the words and colors. Small art needs sharp files: the designer warns you when a logo is below about 250 dpi at this size. Switch to 3D to see the decal on a hard hat.'),
            ('What it costs', 'Decal packs start at {price} with free shipping in the lower 48. The price you see in the designer matches our Etsy listing for the size and pack you pick.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Most orders arrive 4 to 8 business days after you approve.'),
        ],
        'faqs': [
            ('Will the decal be cut to my logo shape?', 'Yes. We die cut it to the shape of your logo when we build your proof. The designer shows the art on a square.'),
            ('Can I order more than one design?', 'The pack price is for one design. For a few different designs, send us a quote request.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
    {
        'id': 'safety', 'slug': 'safety-sign', 'page': 'aluminum-safety-signs', 'name': 'aluminum safety sign pack', 'short': 'safety sign pack',
        'title': 'Design Custom Aluminum Safety Signs Online | Get Seen Signs',
        'desc': 'Design a pack of 12×18 or 18×24 aluminum safety signs online. Choose a Notice, Caution, Warning or Danger style and your own wording, then get a free proof within 12 hours.',
        'h1': ('Design your safety signs.', "We'll proof it."),
        'lede': 'Your logo and your wording on rust-proof aluminum signs. Every sign in a pack can say something different.',
        'alt': 'A pack of custom aluminum safety signs',
        'sections': [
            ('What you can design', 'Choose a pack: 12×18 with 5 or 10 signs, 18×24 with 5 signs, or 12×18 with 5 heavy duty (.063) signs. Pick landscape or portrait. Choose Each sign different in the Sides tab and design every sign in the pack one at a time, or put the same design on all of them.'),
            ('How the designer works', 'Start from a Notice, Caution, Warning or Danger layout, type what each sign should say, and add your logo. The designer keeps your words inside a safe zone and warns you when letters are too small to read from across a room. The 3D view shows the first five signs of a pack.'),
            ('What it costs', 'Safety sign packs start at {price} with free shipping in the lower 48. The price you see in the designer matches our Etsy listing for the pack you pick.'),
            ('What happens next', 'Send your design and we email {proof}. Nothing prints until you approve it. The preview is not the print file: we build that on your proof. Most packs arrive 5 to 9 business days after you approve. These are OSHA style designs, and you are responsible for confirming the signs meet your site\'s safety requirements.'),
        ],
        'faqs': [
            ('Can every sign in a pack say something different?', 'Yes. Choose Each sign different in the Sides tab and design each one.'),
            ('Are these signs OSHA compliant?', 'They are an OSHA style design. You are responsible for confirming the signs meet your site\'s safety requirements.'),
            ('Is the preview the file you print?', 'No. We build the real print file on your free proof, and nothing prints until you approve it.'),
        ],
    },
]


def start_price(slug):
    return min(p for p, _ in BY[slug]['offer_rows'])
