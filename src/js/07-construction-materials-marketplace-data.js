  /* =====================================================================
     Construction Materials Marketplace — data layer (Supabase + browser demo)
     ===================================================================== */
  const MATERIALS = ['Cement', 'Bricks', 'Steel', 'Sand & Crush', 'Tiles', 'Paint', 'Electrical', 'Plumbing', 'Wood', 'Glass', 'Aluminium', 'Hardware', 'Solar', 'Machinery Rental'];
  const MK_CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta', 'Hyderabad', 'Bahawalpur', 'Sargodha', 'Abbottabad'];
  const BUYER_TYPES = { homeowner: 'Homeowner', contractor: 'Contractor', commercial: 'Commercial buyer', dealer: 'Real estate dealer' };
  const PAY_METHODS = { bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', sadapay: 'SadaPay', nayapay: 'NayaPay' };
  const ORDER_STATUS = {
    quote_requested: ['Quote requested', 'info'], quoted: ['Quote received', 'gold'], awaiting_payment: ['Awaiting payment', 'gold'],
    payment_review: ['Payment being verified', 'info'], paid_escrow: ['Paid · held by RAQBO', 'ok'], dispatched: ['Dispatched', 'info'],
    delivered: ['Delivered · confirm receipt', 'gold'], completed: ['Completed · payout pending', 'ok'], released: ['Completed · vendor paid', 'ok'],
    disputed: ['In dispute', 'bad'], refunded: ['Refunded', 'muted'], cancelled: ['Cancelled', 'muted']
  };
  const ESCROW_STEPS = [['awaiting_payment', 'Order placed'], ['payment_review', 'Payment sent'], ['paid_escrow', 'Held by RAQBO'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered'], ['completed', 'Confirmed'], ['released', 'Vendor paid']];
  const MK_SAMPLE = [
    { shop_name: 'Al-Noor Building Materials', owner_name: 'Muhammad Imran', phone: '+923001234501', city: 'Lahore', area: 'Raiwind Road', materials: ['Cement', 'Bricks', 'Sand & Crush'], radius_km: 25, delivery_fee: 3000, delivery_note: 'Same-day delivery across Lahore', bulk_discount: 3, about: 'Wholesale cement, first-class bricks and crush. Same-day delivery across Lahore.', verified: true, escrow_enabled: true,
      products: [['OPC Cement 50 kg', 'CEM-OPC50', 'Cement', 'bag', 1450, 50, 'in_stock', 1420], ['First-class bricks', 'BRK-A1', 'Bricks', '1000 bricks', 17500, 1, 'in_stock'], ['Ravi sand', 'SND-RAVI', 'Sand & Crush', 'truck', 18000, 1, 'low'], ['Margalla crush', 'CRS-MRG', 'Sand & Crush', 'truck', null, 1, 'in_stock']] },
    { shop_name: 'Pak Steel Traders', owner_name: 'Asif Mehmood', phone: '+923211234502', city: 'Karachi', area: 'SITE Area', materials: ['Steel'], radius_km: 60, delivery_fee: 8000, delivery_note: 'Truck delivery within Karachi', bulk_discount: 5, about: 'Grade 60 steel bars, girders and binding wire. Bulk rates for registered buyers and contractors.', verified: true, escrow_enabled: false,
      products: [['Steel bar Grade 60 (12 mm)', 'STL-G60-12', 'Steel', 'ton', 268000, 1, 'in_stock', 271000], ['Binding wire', 'STL-BW', 'Steel', 'kg', null, 50, 'in_stock']] },
    { shop_name: 'Royal Tiles & Sanitary', owner_name: 'Bilal Ahmed', phone: '+923331234503', city: 'Islamabad', area: 'I-9 Markaz', materials: ['Tiles', 'Plumbing'], radius_km: 40, delivery_fee: 2500, delivery_note: 'Delivery in Islamabad & Rawalpindi', bulk_discount: 0, about: 'Porcelain and ceramic tiles, bathroom fittings and sanitary ware.', verified: true, escrow_enabled: true,
      products: [['Porcelain floor tile 60×60', 'TIL-P6060', 'Tiles', 'box', 3200, 10, 'in_stock'], ['Wall-hung commode set', 'PLB-WHC', 'Plumbing', 'set', 38500, 1, 'low']] },
    { shop_name: 'Colour House Paints', owner_name: 'Usman Tariq', phone: '+923451234504', city: 'Rawalpindi', area: 'Saddar', materials: ['Paint'], radius_km: 20, delivery_fee: 1000, delivery_note: 'Free delivery above PKR 50,000', bulk_discount: 4, about: 'Interior and exterior paints, primers and weather coats from leading brands.', verified: false, escrow_enabled: true,
      products: [['Weather coat 16 L', 'PNT-WC16', 'Paint', 'drum', 21500, 1, 'in_stock'], ['Wall primer 16 L', 'PNT-PR16', 'Paint', 'drum', 9800, 1, 'in_stock']] },
    { shop_name: 'Bright Electric Store', owner_name: 'Kamran Ali', phone: '+923121234505', city: 'Faisalabad', area: 'D Ground', materials: ['Electrical'], radius_km: 15, delivery_fee: 800, delivery_note: 'Pickup or local delivery', bulk_discount: 0, about: 'Wiring, switches, DB boxes and LED lighting for homes and commercial projects.', verified: false, escrow_enabled: false,
      products: [['Copper wire 7/29 (90 m)', 'ELC-CW729', 'Electrical', 'coil', null, 1, 'in_stock']] },
    { shop_name: 'Chenab Timber & Glass', owner_name: 'Haroon Rashid', phone: '+923061234506', city: 'Multan', area: 'Vehari Road', materials: ['Wood', 'Glass'], radius_km: 35, delivery_fee: 2000, delivery_note: 'Delivery and fitting available', bulk_discount: 0, about: 'Doors, frames, kitchen wood work and tempered glass cut to size.', verified: true, escrow_enabled: false,
      products: [['Deodar door frame', 'WD-DFR', 'Wood', 'piece', 14500, 1, 'in_stock'], ['Tempered glass 10 mm', 'GLS-T10', 'Glass', 'sq ft', 650, 20, 'in_stock']] }
  ];
  const ESCROW_ACCOUNT = Object.assign({ accountTitle: 'RAQBO', bank: '', iban: '', jazzcash: '', easypaisa: '', sadapay: '', nayapay: '' }, ((window.RAQBO_CONTENT || {}).escrow) || {});
  const mkErr = (e, fb) => { const m = (e && e.message) || ''; return /row-level security/i.test(m) ? 'Please sign in and complete your account first.' : (m.replace(/^.*?:\s*(?=[A-Z])/, '') || fb); };
  const fromVendor = (r) => ({
    id: r.id, ownerId: r.owner_id, shop: r.shop_name, owner: r.owner_name, phone: r.phone, whatsapp: r.whatsapp || r.phone, city: r.city, area: r.area || '',
    materials: r.materials || [], radius: r.radius_km, deliveryFee: Number(r.delivery_fee) || 0, deliveryNote: r.delivery_note || '', bulkDiscount: Number(r.bulk_discount) || 0,
    about: r.about || '', status: r.status, verified: !!r.verified, escrow: !!r.escrow_enabled, adminNote: r.admin_note || '', sample: !!r.is_sample,
    createdAt: Date.parse(r.created_at) || Date.now(), products: [], rating: null
  });
  const fromProduct = (r) => ({ id: r.id, vendorId: r.vendor_id, name: r.name, code: r.code || '', category: r.category, unit: r.unit, price: r.price == null ? null : Number(r.price), prevPrice: r.prev_price == null ? null : Number(r.prev_price), minQty: r.min_qty || 1, brand: r.brand || '', specs: r.specs || '', stock: r.stock, active: r.active !== false, priceAt: Date.parse(r.price_updated_at) || Date.now() });
  const fromOrder = (r) => ({
    id: r.id, ref: r.ref, buyerId: r.buyer_id, vendorId: r.vendor_id, mode: r.mode, status: r.status, items: r.items || [],
    subtotal: r.subtotal == null ? null : Number(r.subtotal), deliveryFee: Number(r.delivery_fee) || 0, discount: Number(r.discount) || 0, total: r.total == null ? null : Number(r.total),
    buyerName: r.buyer_name || '', buyerPhone: r.buyer_phone || '', address: r.delivery_address, city: r.delivery_city, buyerNote: r.buyer_note || '', vendorNote: r.vendor_note || '',
    payMethod: r.payment_method || '', payRef: r.payment_ref || '', payProof: r.payment_proof || '', dispatch: r.dispatch_info || {}, dispute: r.dispute_reason || '',
    createdAt: Date.parse(r.created_at) || Date.now(), updatedAt: Date.parse(r.updated_at) || Date.now(), events: [], reviewed: false
  });

  /* ---- Supabase ---- */
  function mkSupabase(sb) {
    const q = async (p, fb) => { const { data, error } = await p; if (error) throw new Error(mkErr(error, fb)); return data; };
    return {
      async load() {
        const [vs, ps, rs] = await Promise.all([
          q(sb.from('vendors').select('*').order('verified', { ascending: false }).order('created_at', { ascending: true }), 'Could not load vendors.'),
          q(sb.from('vendor_products').select('*').eq('active', true).order('category').order('name'), 'Could not load products.'),
          sb.from('vendor_rating_summary').select('*').then((r) => r.data || [])
        ]);
        const vendors = vs.map(fromVendor); const byV = Object.fromEntries(vendors.map((v) => [v.id, v]));
        ps.map(fromProduct).forEach((p) => { if (byV[p.vendorId]) byV[p.vendorId].products.push(p); });
        rs.forEach((r) => { if (byV[r.vendor_id]) byV[r.vendor_id].rating = { avg: Number(r.avg_rating), count: r.review_count }; });
        let buyer = null; let priv = null; let orders = [];
        if (db.session) {
          const uidv = db.session.userId;
          const [b, os] = await Promise.all([
            sb.from('buyer_profiles').select('*').eq('user_id', uidv).maybeSingle().then((r) => r.data),
            q(sb.from('orders').select('*').order('created_at', { ascending: false }).limit(300), 'Could not load orders.')
          ]);
          buyer = b ? { name: b.display_name, company: b.company_name, type: b.buyer_type, addresses: b.addresses || [], commercial: !!b.registered_commercial } : null;
          orders = os.map(fromOrder);
          if (orders.length) {
            const ids = orders.map((o) => o.id);
            const [ev, rv2] = await Promise.all([
              q(sb.from('order_events').select('*').in('order_id', ids).order('id'), 'Could not load order history.'),
              sb.from('vendor_reviews').select('order_id').in('order_id', ids).then((r) => r.data || [])
            ]);
            const byO = Object.fromEntries(orders.map((o) => [o.id, o]));
            ev.forEach((e) => { if (byO[e.order_id]) byO[e.order_id].events.push({ status: e.status, actor: e.actor, note: e.note, at: Date.parse(e.created_at) }); });
            rv2.forEach((r) => { if (byO[r.order_id]) byO[r.order_id].reviewed = true; });
          }
          const mine = vendors.find((v) => v.ownerId === uidv);
          if (mine) priv = await sb.from('vendor_private').select('*').eq('vendor_id', mine.id).maybeSingle().then((r) => r.data);
        }
        let admin = null;
        if (db.isAdmin && LIVE) {
          const bs = await sb.from('buyer_profiles').select('*').order('created_at', { ascending: false }).limit(300).then((r) => r.data || []);
          admin = { buyers: bs.map((b) => ({ userId: b.user_id, name: b.display_name, company: b.company_name, type: b.buyer_type, commercial: !!b.registered_commercial, createdAt: Date.parse(b.created_at) })) };
        }
        return { vendors, buyer, orders, priv: priv ? { reg: priv.registration_no, warehouse: priv.warehouse_address, payMethod: priv.payout_method, payTitle: priv.payout_title, payAccount: priv.payout_account } : null, admin };
      },
      async saveVendor(v, priv, existingId) {
        const row = { shop_name: v.shop, owner_name: v.owner, phone: v.phone, whatsapp: v.whatsapp || null, city: v.city, area: v.area, materials: v.materials, radius_km: v.radius, delivery_fee: v.deliveryFee, delivery_note: v.deliveryNote, bulk_discount: v.bulkDiscount, about: v.about };
        let id = existingId;
        if (id) await q(sb.from('vendors').update(row).eq('id', id), 'Could not save your shop.');
        else id = (await q(sb.from('vendors').insert({ ...row, owner_id: db.session.userId }).select('id').single(), 'Could not create your shop.')).id;
        await q(sb.from('vendor_private').upsert({ vendor_id: id, registration_no: priv.reg, warehouse_address: priv.warehouse, payout_method: priv.payMethod, payout_title: priv.payTitle, payout_account: priv.payAccount, updated_at: new Date().toISOString() }), 'Could not save private details.');
        return id;
      },
      async saveProduct(p) {
        const row = { vendor_id: p.vendorId, name: p.name, code: p.code, category: p.category, unit: p.unit, price: p.price, min_qty: p.minQty, stock: p.stock, active: true, ...(p.brand || p.specs ? { brand: p.brand || '', specs: p.specs || '' } : {}) };
        if (p.id) await q(sb.from('vendor_products').update(row).eq('id', p.id), 'Could not save the item.');
        else await q(sb.from('vendor_products').insert(row), 'Could not add the item.');
      },
      async deleteProduct(id) { await q(sb.from('vendor_products').update({ active: false }).eq('id', id), 'Could not remove the item.'); },
      async saveBuyer(b) {
        await q(sb.from('buyer_profiles').upsert({ user_id: db.session.userId, display_name: b.name, company_name: b.company, buyer_type: b.type, addresses: b.addresses }), 'Could not save your buyer profile.');
      },
      async placeOrder(o) { return q(sb.rpc('place_order', { p_vendor_id: o.vendorId, p_items: o.items.map((i) => ({ product_id: i.productId, qty: i.qty })), p_mode: o.mode, p_address: o.address, p_city: o.city, p_note: o.note, p_payment_method: o.payMethod || '' }), 'Could not place the order.'); },
      async orderAction(id, action, payload) { return q(sb.rpc('order_action', { p_order_id: id, p_action: action, p_payload: payload || {} }), 'Could not update the order.'); },
      async uploadProof(orderId, file) {
        const ext = ({ 'image/png': 'png', 'image/webp': 'webp' })[file.type] || 'jpg';
        const path = `${db.session.userId}/${orderId}/${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('payment-proofs').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
        if (error) throw new Error(/bucket|not found/i.test(error.message || '') ? 'Screenshot upload is being set up. (Admin: run update_7_payment_proof.sql in Supabase.)' : mkErr(error, 'Could not upload the screenshot.'));
        return path;
      },
      async proofUrl(path) { const { data, error } = await sb.storage.from('payment-proofs').createSignedUrl(path, 3600); if (error) throw new Error('Could not load the screenshot.'); return data.signedUrl; },
      async review(orderId, rating, comment) { await q(sb.from('vendor_reviews').insert({ order_id: orderId, rating, comment }), 'Could not save your review.'); },
      async reviews(vendorId) {
        const d = await q(sb.from('vendor_reviews').select('id, buyer_name, rating, comment, created_at').eq('vendor_id', vendorId).order('created_at', { ascending: false }).limit(100), 'Could not load reviews.');
        return d.map((r) => ({ id: r.id, name: r.buyer_name, rating: r.rating, comment: r.comment, at: Date.parse(r.created_at) }));
      },
      async adminVendor(id, patch) { await q(sb.from('vendors').update(patch).eq('id', id), 'Could not update the vendor.'); },
      async adminBuyer(userId, commercial) { await q(sb.from('buyer_profiles').update({ registered_commercial: commercial }).eq('user_id', userId), 'Could not update the buyer.'); },
      async adminPrivate(vendorId) { return sb.from('vendor_private').select('*').eq('vendor_id', vendorId).maybeSingle().then((r) => r.data); },
      subscribe(cb) {
        const ch = sb.channel('raqbo-market');
        ['vendor_products', 'vendors', 'orders', 'order_events'].forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => cb(t)));
        ch.subscribe(); return () => sb.removeChannel(ch);
      }
    };
  }

  /* ---- Browser demo (same rules as the database) ---- */
  const mkLocal = (() => {
    const K = 'market';
    const read = () => {
      let d = store.get(K, null);
      if (!d) {
        d = { vendors: [], products: [], priv: {}, buyers: {}, orders: [], reviews: [] };
        MK_SAMPLE.forEach((s, i) => {
          const id = 'v-sample-' + (i + 1);
          d.vendors.push({ id, owner_id: null, shop_name: s.shop_name, owner_name: s.owner_name, phone: s.phone, whatsapp: s.phone, city: s.city, area: s.area, materials: s.materials, radius_km: s.radius_km, delivery_fee: s.delivery_fee, delivery_note: s.delivery_note, bulk_discount: s.bulk_discount, about: s.about, status: 'approved', verified: s.verified, escrow_enabled: s.escrow_enabled, admin_note: '', is_sample: true, created_at: new Date(Date.now() - (9 - i) * 86400000).toISOString() });
          s.products.forEach(([name, code, category, unit, price, min, stock, prev], j) => d.products.push({ id: `p-${i + 1}-${j + 1}`, vendor_id: id, name, code, category, unit, price, prev_price: prev || null, min_qty: min, stock, active: true, price_updated_at: new Date(Date.now() - (j + 1) * 3600000 * 5).toISOString() }));
        });
        store.set(K, d);
      }
      return d;
    };
    const write = (d) => { store.set(K, d); setTimeout(() => window.dispatchEvent(new CustomEvent('raqbo-market')), 0); };
    const me = () => { if (!db.session) throw new Error('Please sign in first.'); return db.session.userId; };
    const ev = (o, status, actor, note) => { o.events.push({ status, actor, note, created_at: new Date().toISOString() }); o.status = status; o.updated_at = new Date().toISOString(); try { lvLocalOrderEvent(o, status, actor); } catch { /* ignore */ } };
    return {
      async load() {
        const d = read(); const uidv = db.session && db.session.userId;
        const vs = d.vendors.filter((v) => v.status === 'approved' || v.owner_id === uidv || db.isAdmin || d.orders.some((o) => o.vendor_id === v.id && o.buyer_id === uidv)).map(fromVendor);
        const byV = Object.fromEntries(vs.map((v) => [v.id, v]));
        d.products.filter((p) => p.active).map(fromProduct).forEach((p) => { if (byV[p.vendorId]) byV[p.vendorId].products.push(p); });
        const g = {}; d.reviews.forEach((r) => { (g[r.vendor_id] = g[r.vendor_id] || []).push(r.rating); });
        Object.entries(g).forEach(([k, a]) => { if (byV[k]) byV[k].rating = { avg: Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10, count: a.length }; });
        const myV = vs.find((v) => v.ownerId && v.ownerId === uidv);
        const orders = uidv ? d.orders.filter((o) => o.buyer_id === uidv || (myV && o.vendor_id === myV.id) || db.isAdmin).map((o) => { const x = fromOrder(o); x.events = o.events.map((e) => ({ status: e.status, actor: e.actor, note: e.note, at: Date.parse(e.created_at) })); x.reviewed = d.reviews.some((r) => r.order_id === o.id); return x; }).sort((a, b) => b.createdAt - a.createdAt) : [];
        const b = uidv && d.buyers[uidv];
        const p = myV && d.priv[myV.id];
        return {
          vendors: vs, orders,
          buyer: b ? { name: b.display_name, company: b.company_name, type: b.buyer_type, addresses: b.addresses || [], commercial: !!b.registered_commercial } : null,
          priv: p ? { reg: p.registration_no, warehouse: p.warehouse_address, payMethod: p.payout_method, payTitle: p.payout_title, payAccount: p.payout_account } : null,
          admin: db.isAdmin ? { buyers: Object.values(d.buyers).map((x) => ({ userId: x.user_id, name: x.display_name, company: x.company_name, type: x.buyer_type, commercial: !!x.registered_commercial, createdAt: Date.parse(x.created_at) })) } : null
        };
      },
      async saveVendor(v, priv, existingId) {
        const u = me(); const d = read(); let row = existingId && d.vendors.find((x) => x.id === existingId);
        if (!row && d.vendors.some((x) => x.owner_id === u)) throw new Error('You already have a shop profile.');
        const base = { shop_name: v.shop, owner_name: v.owner, phone: v.phone, whatsapp: v.whatsapp || null, city: v.city, area: v.area, materials: v.materials, radius_km: v.radius, delivery_fee: v.deliveryFee, delivery_note: v.deliveryNote, bulk_discount: v.bulkDiscount, about: v.about, updated_at: new Date().toISOString() };
        if (row) { if (row.owner_id !== u && !db.isAdmin) throw new Error('Not your shop.'); Object.assign(row, base); if (row.status === 'rejected') row.status = 'pending'; }
        else { row = { id: uid('v'), owner_id: u, ...base, status: 'pending', verified: false, escrow_enabled: false, admin_note: '', is_sample: false, created_at: new Date().toISOString() }; d.vendors.push(row); }
        d.priv[row.id] = { registration_no: priv.reg, warehouse_address: priv.warehouse, payout_method: priv.payMethod, payout_title: priv.payTitle, payout_account: priv.payAccount };
        write(d); return row.id;
      },
      async saveProduct(p) {
        const u = me(); const d = read(); const v = d.vendors.find((x) => x.id === p.vendorId); if (!v || (v.owner_id !== u && !db.isAdmin)) throw new Error('Not your shop.');
        const row = { vendor_id: p.vendorId, name: p.name, code: p.code, category: p.category, unit: p.unit, price: p.price, min_qty: p.minQty, stock: p.stock, active: true, ...(p.brand || p.specs ? { brand: p.brand || '', specs: p.specs || '' } : {}) };
        const ex = p.id && d.products.find((x) => x.id === p.id);
        if (ex) { if (ex.price !== row.price) { row.prev_price = ex.price; row.price_updated_at = new Date().toISOString(); } Object.assign(ex, row); }
        else d.products.push({ id: uid('p'), ...row, prev_price: null, price_updated_at: new Date().toISOString() });
        write(d);
      },
      async deleteProduct(id) { const d = read(); const p = d.products.find((x) => x.id === id); if (p) p.active = false; write(d); },
      async saveBuyer(b) { const u = me(); const d = read(); const ex = d.buyers[u]; d.buyers[u] = { user_id: u, display_name: b.name, company_name: b.company, buyer_type: b.type, addresses: b.addresses, registered_commercial: ex ? ex.registered_commercial : false, created_at: ex ? ex.created_at : new Date().toISOString() }; write(d); },
      async placeOrder(o) {
        const u = me(); const d = read(); const b = d.buyers[u]; if (!b) throw new Error('Please complete your buyer profile first.');
        const v = d.vendors.find((x) => x.id === o.vendorId); if (!v || v.status !== 'approved') throw new Error('This vendor is not accepting orders right now.');
        if (v.owner_id === u) throw new Error('You cannot order from your own shop.');
        let sub = 0; let unpriced = false; const lines = o.items.map((it) => {
          const p = d.products.find((x) => x.id === it.productId && x.vendor_id === v.id && x.active); if (!p) throw new Error('An item is no longer available.');
          if (p.stock === 'out') throw new Error(`${p.name} is out of stock.`); if (it.qty < p.min_qty) throw new Error(`Minimum order for ${p.name} is ${p.min_qty} ${p.unit}.`);
          if (p.price == null) unpriced = true; else sub += p.price * it.qty;
          return { product_id: p.id, name: p.name, code: p.code, unit: p.unit, qty: it.qty, price: p.price };
        });
        let mode = o.mode; if (mode === 'order' && (unpriced || !v.escrow_enabled)) mode = 'quote';
        const disc = b.registered_commercial && v.bulk_discount > 0 ? Math.round(sub * v.bulk_discount / 100) : 0;
        const st = mode === 'order' ? 'awaiting_payment' : 'quote_requested';
        const row = { id: uid('o'), ref: 'RQ-ORD-' + Math.random().toString(36).slice(2, 10).toUpperCase(), buyer_id: u, vendor_id: v.id, mode, status: st, items: lines,
          subtotal: unpriced ? null : sub, delivery_fee: v.delivery_fee, discount: disc, total: unpriced ? null : sub + v.delivery_fee - disc,
          buyer_name: b.company_name || b.display_name, buyer_phone: db.session.phone || '', delivery_address: o.address, delivery_city: o.city, buyer_note: o.note || '', vendor_note: '',
          payment_method: o.payMethod || '', payment_ref: '', dispatch_info: {}, dispute_reason: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), events: [] };
        ev(row, st, 'buyer', st === 'quote_requested' ? 'Quote requested' : 'Order placed — waiting for protected payment');
        d.orders.push(row); write(d); return row.id;
      },
      async orderAction(id, action, p = {}) {
        const u = me(); const d = read(); const o = d.orders.find((x) => x.id === id); if (!o) throw new Error('Order not found.');
        const v = d.vendors.find((x) => x.id === o.vendor_id); const adm = db.isAdmin; const buyer = o.buyer_id === u; const vendor = v.owner_id === u || (!v.owner_id && adm);
        const no = () => { throw new Error('This action is not allowed for this order right now.'); };
        const st = o.status; const n = (x) => (x ? ': ' + x : '');
        if (action === 'send_quote' && vendor && st === 'quote_requested') {
          let sub = 0; o.items = o.items.map((it) => { const pr = Number(((p.prices || []).find((x) => x.product_id === it.product_id) || {}).price || it.price); if (!pr) throw new Error('Enter a price for every item.'); sub += pr * it.qty; return { ...it, price: pr }; });
          const b = d.buyers[o.buyer_id]; o.subtotal = sub; o.discount = b && b.registered_commercial && v.bulk_discount > 0 ? Math.round(sub * v.bulk_discount / 100) : 0;
          o.delivery_fee = p.delivery_fee != null ? Number(p.delivery_fee) : o.delivery_fee; o.total = sub + o.delivery_fee - o.discount; o.vendor_note = p.note || '';
          ev(o, 'quoted', 'vendor', 'Quote sent' + n(p.note));
        } else if (action === 'decline' && vendor && ['quote_requested', 'awaiting_payment'].includes(st)) ev(o, 'cancelled', 'vendor', 'Declined by vendor' + n(p.note));
        else if (action === 'accept_quote' && buyer && st === 'quoted') { if (!v.escrow_enabled) throw new Error('This vendor does not accept protected payments yet — contact them on WhatsApp or call.'); ev(o, 'awaiting_payment', 'buyer', 'Quote accepted — waiting for protected payment'); }
        else if (action === 'submit_payment' && buyer && st === 'awaiting_payment') {
          if (!PAY_METHODS[p.method]) throw new Error('Choose how you paid.'); if (!p.proof) throw new Error('Upload a screenshot of your payment.');
          o.payment_method = p.method; o.payment_ref = String(p.reference || '').trim(); o.payment_proof = p.proof; ev(o, 'payment_review', 'buyer', `Payment submitted with screenshot (${p.method}${o.payment_ref ? ', ref ' + o.payment_ref : ''}) — RAQBO is verifying it`);
        } else if (action === 'payment_received' && adm && st === 'payment_review') ev(o, 'paid_escrow', 'admin', 'Payment received and held in RAQBO Protected Payment — vendor can dispatch');
        else if (action === 'payment_rejected' && adm && st === 'payment_review') ev(o, 'awaiting_payment', 'admin', 'Payment could not be verified' + n(p.note));
        else if (action === 'dispatch' && vendor && st === 'paid_escrow') { o.dispatch_info = { vehicle: p.vehicle || '', driver: p.driver || '', phone: p.phone || '', eta: p.eta || '' }; ev(o, 'dispatched', 'vendor', 'Dispatched' + (p.vehicle ? ' · vehicle ' + p.vehicle : '') + (p.eta ? ' · ETA ' + p.eta : '')); }
        else if (action === 'delivered' && vendor && st === 'dispatched') ev(o, 'delivered', 'vendor', 'Marked as delivered by vendor — buyer to inspect and confirm');
        else if (action === 'confirm_delivery' && buyer && ['dispatched', 'delivered'].includes(st)) ev(o, 'completed', 'buyer', 'Buyer confirmed delivery — payout will be released to the vendor');
        else if (action === 'dispute' && buyer && ['paid_escrow', 'dispatched', 'delivered'].includes(st)) { if (String(p.reason || '').trim().length < 5) throw new Error('Describe the problem (at least 5 characters).'); o.dispute_reason = p.reason.trim(); ev(o, 'disputed', 'buyer', 'Dispute opened: ' + o.dispute_reason.slice(0, 200)); }
        else if (action === 'cancel' && buyer && ['quote_requested', 'quoted', 'awaiting_payment'].includes(st)) ev(o, 'cancelled', 'buyer', 'Cancelled by buyer');
        else if (action === 'release_payout' && adm && st === 'completed') ev(o, 'released', 'admin', 'Payout released to vendor' + n(p.note));
        else if (action === 'resolve_release' && adm && st === 'disputed') ev(o, 'released', 'admin', 'Dispute resolved — payout released to vendor' + n(p.note));
        else if (action === 'resolve_refund' && adm && st === 'disputed') ev(o, 'refunded', 'admin', 'Dispute resolved — buyer refunded' + n(p.note));
        else no();
        write(d); return o.status;
      },
      async uploadProof(orderId, file) { me(); const id = 'proof-' + uid('p'); await media.put(id, file); return 'local:' + id; },
      async proofUrl(path) { const u = await media.url(String(path).replace(/^local:/, '')); if (!u) throw new Error('Screenshot not found in this browser.'); return u; },
      async review(orderId, rating, comment) {
        const u = me(); const d = read(); const o = d.orders.find((x) => x.id === orderId);
        if (!o || o.buyer_id !== u || !['completed', 'released'].includes(o.status)) throw new Error('Only buyers who completed an order through RAQBO can review this vendor.');
        if (d.reviews.some((r) => r.order_id === orderId)) throw new Error('You already reviewed this order.');
        d.reviews.push({ id: uid('vr'), vendor_id: o.vendor_id, order_id: orderId, buyer_id: u, buyer_name: db.session.name || 'RAQBO buyer', rating, comment: comment.trim(), created_at: new Date().toISOString() }); write(d);
      },
      async reviews(vendorId) { return read().reviews.filter((r) => r.vendor_id === vendorId).map((r) => ({ id: r.id, name: r.buyer_name, rating: r.rating, comment: r.comment, at: Date.parse(r.created_at) })).sort((a, b) => b.at - a.at); },
      async adminVendor(id, patch) { const d = read(); const v = d.vendors.find((x) => x.id === id); if (v) Object.assign(v, patch); write(d); },
      async adminBuyer(userId, commercial) { const d = read(); if (d.buyers[userId]) d.buyers[userId].registered_commercial = commercial; write(d); },
      async adminPrivate(vendorId) { return read().priv[vendorId] || null; },
      subscribe(cb) {
        const a = () => cb('local'); const s = (e) => { if (e.key && e.key.endsWith(K)) cb('storage'); };
        window.addEventListener('raqbo-market', a); window.addEventListener('storage', s);
        return () => { window.removeEventListener('raqbo-market', a); window.removeEventListener('storage', s); };
      }
    };
  })();
  const MK = SB ? mkSupabase(SB) : mkLocal;

