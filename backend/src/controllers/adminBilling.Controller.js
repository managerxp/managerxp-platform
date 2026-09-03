/*
 * SaaS billing — invoices, payments and refunds for what cafés pay ManagerXP.
 *
 * The whole module obeys three rules, and nearly every oddity below is one of
 * them being taken seriously.
 *
 *   1. Money is never computed on read. An invoice stores the price, the
 *      discount and the tax rate that applied the day it was issued. Read it
 *      back in a year and it still says what the customer actually agreed to,
 *      whatever the package costs by then.
 *
 *   2. Financial records are never deleted. An invoice raised in error is
 *      VOIDED with a reason; the number stays used, because a gap in a
 *      numbered sequence is a question somebody will eventually have to answer.
 *
 *   3. A refund always points at the payment it reverses, and can never exceed
 *      it. That is what keeps "how much of this is still ours" answerable
 *      without reconstructing history.
 */
import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Months covered by one billing cycle. */
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

const addMonths = (date, months) => {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  /* Guard the 31st. Adding a month to 31 January gives 3 March by default,
     which would bill a customer for a period that starts before the one it
     follows. Clamp to the last day of the target month instead. */
  if (d.getDate() < day) d.setDate(0);
  return d;
};

const nextNumber = async (client, seq, prefix) => {
  const { rows } = await client.query(`SELECT nextval($1) AS n`, [seq]);
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(rows[0].n).padStart(6, '0')}`;
};

/**
 * Recalculate an invoice's paid/refunded totals and status from its rows.
 *
 * Derived rather than incremented, so a double-posted webhook or a
 * half-finished request cannot leave the invoice permanently disagreeing with
 * the payments attached to it.
 */
const recalcInvoice = async (client, invoiceId) => {
  /* `paid` is GROSS — every payment that actually arrived, including ones
     since refunded. Refunds are tracked separately and subtracted once.
     Excluding a refunded payment here while also counting its refund would
     deduct the same money twice, and the invoice would claim a customer who
     paid and was reimbursed had never paid at all. */
  const sums = (await client.query(`
    SELECT
      COALESCE((SELECT SUM(amount) FROM subscription_payments
                 WHERE invoice_id = $1 AND status NOT IN ('FAILED','PENDING')), 0) AS paid,
      COALESCE((SELECT SUM(amount) FROM subscription_refunds
                 WHERE invoice_id = $1 AND status = 'COMPLETED'), 0) AS refunded
  `, [invoiceId])).rows[0];

  const invoice = (await client.query(
    'SELECT * FROM subscription_invoices WHERE invoice_id = $1', [invoiceId])).rows[0];
  if (!invoice) return null;

  const paid = money(sums.paid);
  const refunded = money(sums.refunded);
  const total = money(invoice.total);

  let status = invoice.status;
  if (status !== 'VOID') {
    if (refunded > 0 && refunded >= paid && paid > 0) status = 'REFUNDED';
    else if (refunded > 0) status = 'PARTIALLY_REFUNDED';
    else if (paid >= total && total > 0) status = 'PAID';
    else if (paid > 0) status = 'PARTIALLY_PAID';
    else if (invoice.due_date && new Date(invoice.due_date) < new Date()) status = 'OVERDUE';
    else status = 'OPEN';
  }

  const { rows } = await client.query(`
    UPDATE subscription_invoices
    SET amount_paid = $2, amount_refunded = $3, status = $4::text,
        paid_at = CASE WHEN $4::text = 'PAID' AND paid_at IS NULL THEN CURRENT_TIMESTAMP ELSE paid_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE invoice_id = $1 RETURNING *
  `, [invoiceId, paid, refunded, status]);
  return rows[0];
};

/* ==========================================================================
   INVOICE GENERATION
   ========================================================================== */

/**
 * Build one invoice for one subscription, covering the period that starts on
 * `periodStart`. Returns null when an invoice for that period already exists,
 * which is what makes the billing run safe to repeat.
 */
const issueInvoice = async (client, subscriptionId, periodStart, { notes } = {}) => {
  const sub = (await client.query(`
    SELECT s.*, o.name AS organization_name, o.currency AS org_currency,
           p.name AS plan_name, p.code AS plan_code
    FROM subscriptions s
    LEFT JOIN organizations o ON o.organization_id = s.organization_id
    LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
    WHERE s.subscription_id = $1
  `, [subscriptionId])).rows[0];
  if (!sub) return { error: 'No such subscription' };

  /* A trial is not billable. Issuing a zero invoice for one would fill the
     ledger with documents nobody ever pays or reads. */
  if (sub.type === 'TRIAL') return { skipped: 'trial' };
  if (['CANCELLED'].includes(sub.status)) return { skipped: 'cancelled' };

  const period = sub.billing_period || 'monthly';
  const months = CYCLE_MONTHS[period] || 1;
  const start = new Date(periodStart);
  const end = addMonths(start, months);

  const clash = (await client.query(`
    SELECT invoice_id, invoice_no FROM subscription_invoices
    WHERE subscription_id = $1 AND period_start = $2::date AND status <> 'VOID'
  `, [subscriptionId, start.toISOString().slice(0, 10)])).rows[0];
  if (clash) return { skipped: 'already_invoiced', invoice_no: clash.invoice_no };

  /* Lines: the package, then each active add-on. Prices come from the
     subscription and from the add-on's snapshot, never from today's catalogue. */
  const lines = [];
  const listPrice = money(sub.list_price ?? 0);
  const netPrice = money(sub.net_price ?? listPrice);
  lines.push({
    kind: 'PLAN',
    description: `${sub.plan_name || 'Subscription'} — ${period.replace('_', '-')}`,
    quantity: 1, unit_price: listPrice, amount: listPrice
  });

  const addons = (await client.query(`
    SELECT sa.quantity, sa.price_snapshot, a.name
    FROM subscription_addons sa JOIN addons a ON a.addon_id = sa.addon_id
    WHERE sa.subscription_id = $1 AND sa.status = 'ACTIVE'
      AND (sa.expires_at IS NULL OR sa.expires_at > NOW())
  `, [subscriptionId])).rows;
  for (const ad of addons) {
    lines.push({
      kind: 'ADDON', description: ad.name,
      quantity: ad.quantity, unit_price: money(Number(ad.price_snapshot) / (ad.quantity || 1)),
      amount: money(ad.price_snapshot)
    });
  }

  const subtotal = money(lines.reduce((n, l) => n + l.amount, 0));
  /* The discount applies to the package only — an add-on is priced as sold.
     Expressed as an amount rather than re-deriving the percentage, so the
     invoice is readable a year later without knowing the rule. */
  const discount = money(Math.max(0, listPrice - netPrice));
  const taxPercent = Number(await getSetting('platform.tax_percent', 18));
  const taxable = money(subtotal - discount);
  const tax = money(taxable * (taxPercent / 100));
  const total = money(taxable + tax);

  const dueDays = Number(await getSetting('platform.invoice_due_days', 7));
  const prefix = String(await getSetting('platform.invoice_prefix', 'INV'));
  const invoiceNo = await nextNumber(client, 'subscription_invoice_no_seq', prefix);

  const invoice = (await client.query(`
    INSERT INTO subscription_invoices
      (invoice_no, organization_id, subscription_id, cafe_id, period_start, period_end,
       billing_period, currency, subtotal, discount_amount, tax_percent, tax_amount,
       total, status, due_date, notes)
    VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13,'OPEN',
            (CURRENT_DATE + ($14::int || ' days')::interval)::date, $15)
    RETURNING *
  `, [invoiceNo, sub.organization_id, subscriptionId, sub.cafe_id,
      start.toISOString().slice(0, 10), end.toISOString().slice(0, 10),
      period, sub.currency || sub.org_currency || 'INR',
      subtotal, discount, taxPercent, tax, total, dueDays, notes || null])).rows[0];

  let order = 0;
  for (const l of lines) {
    await client.query(`
      INSERT INTO subscription_invoice_lines
        (invoice_id, kind, description, quantity, unit_price, amount, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [invoice.invoice_id, l.kind, l.description, l.quantity, l.unit_price, l.amount, order++]);
  }

  return { invoice };
};

/**
 * POST /api/admin/billing/run   { dry_run?, subscription_id? }
 *
 * The monthly run. Issues an invoice for every paid subscription whose current
 * period has no invoice yet.
 *
 * `dry_run` is the default in the UI on purpose: this is the one operation
 * here that creates money owed, across every customer at once, and seeing the
 * list before committing to it is worth the extra click.
 */
export const runBilling = async (req, res) => {
  const client = await pool.connect();
  try {
    const dryRun = req.body?.dry_run !== false;
    const only = req.body?.subscription_id ? Number(req.body.subscription_id) : null;

    const due = (await client.query(`
      SELECT s.subscription_id, s.organization_id, s.billing_period, s.net_price,
             s.list_price, s.currency, s.start_date, s.end_date, s.status, s.type,
             o.name AS organization_name, p.name AS plan_name
      FROM subscriptions s
      LEFT JOIN organizations o ON o.organization_id = s.organization_id
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
      WHERE s.type <> 'TRIAL'
        AND s.status IN ('ACTIVE','PAST_DUE','GRACE_PERIOD')
        AND ($1::int IS NULL OR s.subscription_id = $1::int)
      ORDER BY o.name
    `, [only])).rows;

    const results = [];
    for (const s of due) {
      /* The period being billed starts the day after the last one billed, or
         at the subscription's start if this is the first invoice. Deriving it
         from the invoice history rather than from today means a run that was
         missed for a week still bills the right month. */
      const last = (await client.query(`
        SELECT period_end FROM subscription_invoices
        WHERE subscription_id = $1 AND status <> 'VOID'
        ORDER BY period_end DESC LIMIT 1
      `, [s.subscription_id])).rows[0];

      const periodStart = last ? new Date(last.period_end) : new Date(s.start_date || Date.now());

      /* Not due yet: the next period has not begun. */
      if (periodStart > new Date()) {
        results.push({ subscription_id: s.subscription_id, organization: s.organization_name,
                       skipped: 'not_due', next_period: periodStart.toISOString().slice(0, 10) });
        continue;
      }

      if (dryRun) {
        const months = CYCLE_MONTHS[s.billing_period || 'monthly'] || 1;
        results.push({
          subscription_id: s.subscription_id, organization: s.organization_name,
          plan: s.plan_name, would_bill: money(s.net_price ?? s.list_price ?? 0),
          currency: s.currency || 'INR',
          period_start: periodStart.toISOString().slice(0, 10),
          period_end: addMonths(periodStart, months).toISOString().slice(0, 10)
        });
        continue;
      }

      await client.query('BEGIN');
      try {
        const out = await issueInvoice(client, s.subscription_id, periodStart);
        await client.query('COMMIT');
        if (out.invoice) {
          results.push({ subscription_id: s.subscription_id, organization: s.organization_name,
                         invoice_no: out.invoice.invoice_no, total: money(out.invoice.total) });
        } else {
          results.push({ subscription_id: s.subscription_id, organization: s.organization_name,
                         skipped: out.skipped || out.error });
        }
      } catch (e) {
        await client.query('ROLLBACK');
        /* One customer's failure must not abandon the rest of the run. */
        console.error(`Billing failed for subscription ${s.subscription_id}:`, e.message);
        results.push({ subscription_id: s.subscription_id, organization: s.organization_name,
                       error: e.message });
      }
    }

    const issued = results.filter((r) => r.invoice_no);
    if (!dryRun && issued.length) {
      await recordAdminAudit(req, {
        action: 'billing.run', resource_type: 'billing',
        new_value: { issued: issued.length, invoices: issued.map((i) => i.invoice_no) }
      });
    }

    res.json({
      success: true,
      message: dryRun
        ? `${results.filter((r) => r.would_bill != null).length} subscription(s) would be invoiced`
        : `${issued.length} invoice(s) issued`,
      data: { dry_run: dryRun, results }
    });
  } catch (error) {
    console.error('Billing run failed:', error);
    res.status(500).json({ success: false, message: 'The billing run could not complete' });
  } finally {
    client.release();
  }
};

/** POST /api/admin/invoices — raise one by hand. */
export const createInvoice = async (req, res) => {
  const client = await pool.connect();
  try {
    const subscriptionId = Number(req.body?.subscription_id);
    if (!subscriptionId) {
      return res.status(400).json({ success: false, message: 'A subscription is required' });
    }
    const periodStart = req.body?.period_start ? new Date(req.body.period_start) : new Date();

    await client.query('BEGIN');
    const out = await issueInvoice(client, subscriptionId, periodStart, { notes: req.body?.notes });
    if (!out.invoice) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: out.error || `Nothing to invoice (${out.skipped})`,
        data: out
      });
    }
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'invoice.created', resource_type: 'invoice', resource_id: out.invoice.invoice_id,
      organization_id: out.invoice.organization_id,
      new_value: { invoice_no: out.invoice.invoice_no, total: out.invoice.total }
    });

    res.status(201).json({ success: true, message: `${out.invoice.invoice_no} raised`, data: out.invoice });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Invoice creation failed:', error);
    res.status(500).json({ success: false, message: 'Could not raise that invoice' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   READING
   ========================================================================== */

/** GET /api/admin/invoices?q=&status=&organization_id= */
export const listInvoices = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(200, Number(req.query.size) || 50);
    const params = [];
    const where = [];

    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(LOWER(i.invoice_no) LIKE $${params.length} OR LOWER(COALESCE(o.name,'')) LIKE $${params.length})`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where.push(`i.status = $${params.length}`);
    }
    if (req.query.organization_id) {
      params.push(Number(req.query.organization_id));
      where.push(`i.organization_id = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totals = (await pool.query(`
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(i.total) FILTER (WHERE i.status <> 'VOID'), 0) AS billed,
             COALESCE(SUM(i.amount_paid), 0) AS collected,
             COALESCE(SUM(i.total - i.amount_paid) FILTER
               (WHERE i.status IN ('OPEN','PARTIALLY_PAID','OVERDUE')), 0) AS outstanding
      FROM subscription_invoices i
      LEFT JOIN organizations o ON o.organization_id = i.organization_id ${clause}
    `, params)).rows[0];

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT i.*, o.name AS organization_name, o.email AS organization_email,
             p.name AS plan_name, (i.total - i.amount_paid) AS balance
      FROM subscription_invoices i
      LEFT JOIN organizations o ON o.organization_id = i.organization_id
      LEFT JOIN subscriptions s ON s.subscription_id = i.subscription_id
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
      ${clause}
      ORDER BY i.issued_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      success: true,
      data: {
        items: rows, total: totals.n, page, size,
        summary: {
          billed: money(totals.billed),
          collected: money(totals.collected),
          outstanding: money(totals.outstanding)
        }
      }
    });
  } catch (error) {
    console.error('Invoice list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load invoices' });
  }
};

/** GET /api/admin/invoices/:id */
export const getInvoice = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const invoice = (await pool.query(`
      SELECT i.*, o.name AS organization_name, o.email AS organization_email,
             o.address, o.city, o.tax_number
      FROM subscription_invoices i
      LEFT JOIN organizations o ON o.organization_id = i.organization_id
      WHERE i.invoice_id = $1
    `, [id])).rows[0];
    if (!invoice) return res.status(404).json({ success: false, message: 'Not found' });

    const [lines, payments, refunds] = await Promise.all([
      pool.query('SELECT * FROM subscription_invoice_lines WHERE invoice_id = $1 ORDER BY sort_order',
        [id]).then((r) => r.rows),
      pool.query('SELECT * FROM subscription_payments WHERE invoice_id = $1 ORDER BY received_at',
        [id]).then((r) => r.rows),
      pool.query('SELECT * FROM subscription_refunds WHERE invoice_id = $1 ORDER BY created_at',
        [id]).then((r) => r.rows)
    ]);

    res.json({ success: true, data: { invoice, lines, payments, refunds } });
  } catch (error) {
    console.error('Invoice detail failed:', error);
    res.status(500).json({ success: false, message: 'Could not load that invoice' });
  }
};

/** GET /api/admin/payments?q=&status=&organization_id= */
export const listPayments = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(200, Number(req.query.size) || 50);
    const params = [];
    const where = [];

    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(o.name,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(sp.reference,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(sp.provider_payment_id,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(i.invoice_no,'')) LIKE $${params.length})`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where.push(`sp.status = $${params.length}`);
    }
    if (req.query.organization_id) {
      params.push(Number(req.query.organization_id));
      where.push(`(sp.organization_id = $${params.length} OR c.organization_id = $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totals = (await pool.query(`
      SELECT COUNT(*)::int AS n,
             /* Gross in, then refunds subtracted once — see recalcInvoice.
                Dropping refunded payments out of "received" while still
                counting them in "refunded" makes the net wrong by exactly the
                refunded amount. */
             COALESCE(SUM(sp.amount) FILTER (WHERE sp.status NOT IN ('FAILED','PENDING')), 0) AS received,
             COALESCE(SUM(sp.amount_refunded), 0) AS refunded
      FROM subscription_payments sp
      LEFT JOIN cafes c ON c.cafe_id = sp.cafe_id
      LEFT JOIN organizations o ON o.organization_id = COALESCE(sp.organization_id, c.organization_id)
      LEFT JOIN subscription_invoices i ON i.invoice_id = sp.invoice_id
      ${clause}
    `, params)).rows[0];

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT sp.*, o.name AS organization_name, i.invoice_no,
             (sp.amount - sp.amount_refunded) AS net_amount
      FROM subscription_payments sp
      LEFT JOIN cafes c ON c.cafe_id = sp.cafe_id
      LEFT JOIN organizations o ON o.organization_id = COALESCE(sp.organization_id, c.organization_id)
      LEFT JOIN subscription_invoices i ON i.invoice_id = sp.invoice_id
      ${clause}
      ORDER BY sp.received_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      success: true,
      data: {
        items: rows, total: totals.n, page, size,
        summary: { received: money(totals.received), refunded: money(totals.refunded),
                   net: money(totals.received - totals.refunded) }
      }
    });
  } catch (error) {
    console.error('Payment list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load payments' });
  }
};

/* ==========================================================================
   WRITING
   ========================================================================== */

/** POST /api/admin/invoices/:id/payments  { amount, method, reference, note } */
export const recordPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const invoiceId = Number(req.params.id);
    const amount = money(req.body?.amount);
    if (!(amount > 0)) {
      return res.status(400).json({ success: false, message: 'Enter an amount greater than zero' });
    }

    const invoice = (await client.query(
      'SELECT * FROM subscription_invoices WHERE invoice_id = $1', [invoiceId])).rows[0];
    if (!invoice) return res.status(404).json({ success: false, message: 'Not found' });
    if (invoice.status === 'VOID') {
      return res.status(409).json({ success: false, message: 'That invoice has been voided' });
    }

    /* Overpayment is refused rather than absorbed. A figure typed with an
       extra zero should be a question, not a credit nobody notices. */
    const outstanding = money(Number(invoice.total) - Number(invoice.amount_paid));
    if (amount > outstanding) {
      return res.status(409).json({
        success: false,
        message: `That is more than the ${invoice.invoice_no} balance of ${outstanding}.`,
        data: { outstanding }
      });
    }

    await client.query('BEGIN');
    const payment = (await client.query(`
      INSERT INTO subscription_payments
        (cafe_id, organization_id, subscription_id, invoice_id, amount, currency,
         method, reference, note, status, received_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUCCESS',COALESCE($10::timestamptz, CURRENT_TIMESTAMP))
      RETURNING *
    `, [invoice.cafe_id, invoice.organization_id, invoice.subscription_id, invoiceId,
        amount, invoice.currency,
        String(req.body?.method || 'bank_transfer'),
        req.body?.reference ? String(req.body.reference).slice(0, 160) : null,
        req.body?.note ? String(req.body.note).slice(0, 255) : null,
        req.body?.received_at || null])).rows[0];

    const updated = await recalcInvoice(client, invoiceId);
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'payment.recorded', resource_type: 'invoice', resource_id: invoiceId,
      organization_id: invoice.organization_id,
      new_value: { invoice_no: invoice.invoice_no, amount, method: payment.method }
    });

    res.status(201).json({
      success: true,
      message: `${amount} recorded against ${invoice.invoice_no}`,
      data: { payment, invoice: updated }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Payment record failed:', error);
    res.status(500).json({ success: false, message: 'Could not record that payment' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/admin/payments/:id/refund  { amount, reason, method }
 *
 * Full and partial both, and never more than what remains of the payment.
 * The refund stays attached to the payment and the invoice, which is section
 * 32's requirement and the only way the invoice's balance stays truthful.
 */
export const refundPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const paymentId = Number(req.params.id);
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'A reason is required to issue a refund' });
    }

    /* Locked for the duration. Two operators refunding the same payment at
       once would otherwise each see the same remaining balance and both
       succeed, refunding twice what was taken. */
    await client.query('BEGIN');
    const payment = (await client.query(
      'SELECT * FROM subscription_payments WHERE payment_id = $1 FOR UPDATE', [paymentId])).rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const alreadyRefunded = money(payment.amount_refunded);
    const remaining = money(Number(payment.amount) - alreadyRefunded);

    /* Checked before the amount, because "nothing remains" and "you typed
       zero" are different problems and only one of them is the operator's
       mistake. Omitting the amount means "refund the rest", which on a fully
       refunded payment would otherwise be reported as an invalid number. */
    if (remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This payment has already been refunded in full.',
        data: { amount: money(payment.amount), already_refunded: alreadyRefunded, remaining: 0 }
      });
    }

    const amount = req.body?.amount === undefined ? remaining : money(req.body.amount);

    if (!(amount > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Enter an amount greater than zero' });
    }
    if (amount > remaining) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: remaining === 0
          ? 'This payment has already been refunded in full.'
          : `Only ${remaining} of this payment remains refundable.`,
        data: { amount: money(payment.amount), already_refunded: alreadyRefunded, remaining }
      });
    }

    const refundNo = await nextNumber(client, 'subscription_refund_no_seq', 'REF');
    const refund = (await client.query(`
      INSERT INTO subscription_refunds
        (refund_no, invoice_id, payment_id, organization_id, amount, currency,
         reason, method, reference, status, refunded_by, refunded_by_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'COMPLETED',$10,$11)
      RETURNING *
    `, [refundNo, payment.invoice_id, paymentId, payment.organization_id, amount,
        payment.currency, reason, String(req.body?.method || 'original'),
        req.body?.reference ? String(req.body.reference).slice(0, 160) : null,
        req.admin?.admin_user_id || null, req.admin?.email || null])).rows[0];

    const totalRefunded = money(alreadyRefunded + amount);
    await client.query(`
      UPDATE subscription_payments
      SET amount_refunded = $2,
          status = CASE WHEN $2 >= amount THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END
      WHERE payment_id = $1
    `, [paymentId, totalRefunded]);

    const invoice = payment.invoice_id ? await recalcInvoice(client, payment.invoice_id) : null;
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'payment.refunded', resource_type: 'payment', resource_id: paymentId,
      organization_id: payment.organization_id,
      old_value: { amount: money(payment.amount), already_refunded: alreadyRefunded },
      new_value: { refund_no: refundNo, amount, reason }
    });

    res.status(201).json({
      success: true,
      message: amount === remaining && alreadyRefunded === 0
        ? `${refundNo}: full refund of ${amount}`
        : `${refundNo}: ${amount} refunded`,
      data: { refund, invoice }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Refund failed:', error);
    res.status(500).json({ success: false, message: 'Could not issue that refund' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/admin/invoices/:id/void  { reason }
 *
 * The nearest thing to deleting an invoice. The row and its number survive.
 */
export const voidInvoice = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'A reason is required to void an invoice' });
    }

    const invoice = (await client.query(
      'SELECT * FROM subscription_invoices WHERE invoice_id = $1', [id])).rows[0];
    if (!invoice) return res.status(404).json({ success: false, message: 'Not found' });

    /* An invoice with money against it cannot be voided — that would orphan a
       payment. Refund it first; then the void is honest. */
    if (Number(invoice.amount_paid) > 0) {
      return res.status(409).json({
        success: false,
        message: `${invoice.invoice_no} has payments against it. Refund them before voiding.`
      });
    }

    const updated = (await client.query(`
      UPDATE subscription_invoices
      SET status = 'VOID', voided_at = CURRENT_TIMESTAMP, void_reason = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE invoice_id = $1 RETURNING *
    `, [id, reason])).rows[0];

    await recordAdminAudit(req, {
      action: 'invoice.voided', resource_type: 'invoice', resource_id: id,
      organization_id: invoice.organization_id,
      old_value: { status: invoice.status, total: invoice.total },
      new_value: { status: 'VOID', reason }
    });

    res.json({ success: true, message: `${invoice.invoice_no} voided`, data: updated });
  } catch (error) {
    console.error('Invoice void failed:', error);
    res.status(500).json({ success: false, message: 'Could not void that invoice' });
  } finally {
    client.release();
  }
};

export { issueInvoice, recalcInvoice };
