import { getDb } from "../../core/db.js";
import type { BillingConfig } from "./index.js";
import { randomUUID } from "node:crypto";

export type SubStatus = "none" | "active" | "cancelled";

export interface BillingAccount {
  userId: number;
  modelId: string;
  subStatus: SubStatus;
  subExpiresAt: number;
  subPeriodStart: number;
  baseUsedTokens: number;
  packsTokens: number;
  totalUsedTokens: number;
  lastChargeId: string | null;
}

export interface BillingEvent {
  id: number;
  userId: number;
  type: string;
  payload: unknown;
  amount: number | null;
  createdAt: string;
}

export interface ChargeResult {
  ok: boolean;
  cost: number;
  remaining: number;
  reason?: "no_subscription" | "no_quota";
}

type AccountRow = {
  user_id: number;
  model_id: string;
  sub_status: string;
  sub_expires_at: number;
  sub_period_start: number;
  base_used_tokens: number;
  packs_tokens: number;
  total_used_tokens: number;
  last_charge_id: string | null;
  created_at: string;
  updated_at: string;
};

interface PaymentInfo {
  telegram_payment_charge_id: string;
  total_amount: number;
  subscription_expiration_date?: number;
  is_recurring?: true;
  is_first_recurring?: true;
  invoice_payload: string;
}

interface PackLike {
  id: string;
  name: string;
  tokens: number;
}

export interface IssuedInvoice {
  id: string;
  userId: number;
  kind: "subscription" | "pack";
  productId: string | null;
  title: string;
  currency: string;
  amount: number;
  tokens: number | null;
  subscriptionPeriod: number | null;
  status: "issued" | "paid" | "void";
}

type InvoiceRow = {
  id: string;
  user_id: number;
  kind: "subscription" | "pack";
  product_id: string | null;
  title: string;
  currency: string;
  amount: number;
  tokens: number | null;
  subscription_period: number | null;
  status: "issued" | "paid" | "void";
};

function rowToInvoice(row: InvoiceRow): IssuedInvoice {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    productId: row.product_id,
    title: row.title,
    currency: row.currency,
    amount: row.amount,
    tokens: row.tokens,
    subscriptionPeriod: row.subscription_period,
    status: row.status,
  };
}

function rowToAccount(row: AccountRow): BillingAccount {
  return {
    userId: row.user_id,
    modelId: row.model_id,
    subStatus: (row.sub_status as SubStatus) ?? "none",
    subExpiresAt: row.sub_expires_at,
    subPeriodStart: row.sub_period_start,
    baseUsedTokens: row.base_used_tokens,
    packsTokens: row.packs_tokens,
    totalUsedTokens: row.total_used_tokens,
    lastChargeId: row.last_charge_id,
  };
}

export class BillingService {
  constructor(
    public readonly config: BillingConfig,
    private readonly defaultModel: string | (() => string)
  ) {}

  private defaultModelId(): string {
    return typeof this.defaultModel === "function" ? this.defaultModel() : this.defaultModel;
  }

  issueInvoice(input: Omit<IssuedInvoice, "id" | "status">): IssuedInvoice {
    const invoice: IssuedInvoice = { ...input, id: randomUUID(), status: "issued" };
    getDb()
      .prepare(
        `INSERT INTO billing_invoices
       (id, user_id, kind, product_id, title, currency, amount, tokens, subscription_period, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`
      )
      .run(
        invoice.id,
        invoice.userId,
        invoice.kind,
        invoice.productId,
        invoice.title,
        invoice.currency,
        invoice.amount,
        invoice.tokens,
        invoice.subscriptionPeriod,
        new Date().toISOString()
      );
    return invoice;
  }

  getInvoice(id: string): IssuedInvoice | null {
    const row = getDb()
      .prepare<[string], InvoiceRow>("SELECT * FROM billing_invoices WHERE id = ?")
      .get(id);
    return row ? rowToInvoice(row) : null;
  }

  validateInvoice(
    userId: number,
    id: string,
    currency: string,
    amount: number
  ): IssuedInvoice | null {
    const invoice = this.getInvoice(id);
    if (
      !invoice ||
      invoice.userId !== userId ||
      invoice.currency !== currency ||
      invoice.amount !== amount
    )
      return null;
    if (invoice.kind === "pack" && invoice.status !== "issued") return null;
    if (invoice.status === "void") return null;
    return invoice;
  }

  fulfillInvoice(input: {
    userId: number;
    invoiceId: string;
    currency: string;
    amount: number;
    chargeId: string;
    subscriptionExpirationDate?: number;
    isRecurring?: true;
    isFirstRecurring?: true;
  }): IssuedInvoice | null {
    return getDb().transaction(() => {
      const duplicate = getDb()
        .prepare<
          [string],
          { invoice_id: string }
        >("SELECT invoice_id FROM billing_payments WHERE telegram_payment_charge_id = ?")
        .get(input.chargeId);
      if (duplicate)
        return duplicate.invoice_id === input.invoiceId ? this.getInvoice(input.invoiceId) : null;
      const invoice = this.validateInvoice(
        input.userId,
        input.invoiceId,
        input.currency,
        input.amount
      );
      if (!invoice) return null;
      getDb()
        .prepare(
          `INSERT INTO billing_payments (telegram_payment_charge_id, invoice_id, user_id, currency, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.chargeId,
          invoice.id,
          input.userId,
          input.currency,
          input.amount,
          new Date().toISOString()
        );
      if (invoice.kind === "pack") {
        this.recordPackPurchase(input.userId, {
          id: invoice.productId ?? invoice.id,
          name: invoice.title,
          tokens: invoice.tokens ?? 0,
        });
        getDb()
          .prepare("UPDATE billing_invoices SET status = 'paid', paid_at = ? WHERE id = ?")
          .run(new Date().toISOString(), invoice.id);
      } else {
        this.recordSubscriptionPayment(input.userId, {
          telegram_payment_charge_id: input.chargeId,
          total_amount: input.amount,
          subscription_expiration_date: input.subscriptionExpirationDate,
          is_recurring: input.isRecurring,
          is_first_recurring: input.isFirstRecurring,
          invoice_payload: invoice.id,
        });
      }
      return invoice;
    })();
  }

  ensureAccount(userId: number): BillingAccount {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO billing_accounts
           (user_id, model_id, sub_status, sub_expires_at, sub_period_start,
            base_used_tokens, packs_tokens, total_used_tokens, last_charge_id,
            created_at, updated_at)
         VALUES (?, ?, 'none', 0, 0, 0, 0, 0, NULL, ?, ?)
         ON CONFLICT(user_id) DO NOTHING`
      )
      .run(userId, this.defaultModelId(), now, now);
    return this.readRaw(userId) as BillingAccount;
  }

  private readRaw(userId: number): BillingAccount | null {
    const row = getDb()
      .prepare<[number], AccountRow>(`SELECT * FROM billing_accounts WHERE user_id = ?`)
      .get(userId);
    return row ? rowToAccount(row) : null;
  }

  /** Lazily lapse an expired subscription. Mutates the DB if needed. */
  reconcile(acc: BillingAccount): BillingAccount {
    if (acc.subStatus !== "none" && Math.floor(Date.now() / 1000) > acc.subExpiresAt) {
      getDb()
        .prepare(
          `UPDATE billing_accounts SET
             sub_status = 'none',
             sub_expires_at = 0,
             sub_period_start = 0,
             base_used_tokens = 0,
             packs_tokens = 0,
             last_charge_id = NULL,
             updated_at = ?
           WHERE user_id = ?`
        )
        .run(new Date().toISOString(), acc.userId);
      this.logEvent(acc.userId, "subscription_lapse", { expiredAt: acc.subExpiresAt }, null);
      return this.readRaw(acc.userId) as BillingAccount;
    }
    return acc;
  }

  getAccount(userId: number): BillingAccount {
    const acc = this.ensureAccount(userId);
    return this.reconcile(acc);
  }

  hasActiveSub(acc: BillingAccount): boolean {
    return acc.subStatus !== "none";
  }

  /** Tokens a user can still spend (base quota remainder + purchased packs). */
  effectiveRemaining(acc: BillingAccount): number {
    if (!this.hasActiveSub(acc)) return 0;
    const base = Math.max(0, this.config.baseQuotaTokens - acc.baseUsedTokens);
    return base + acc.packsTokens;
  }

  selectModel(userId: number, modelId: string): void {
    this.ensureAccount(userId);
    const id = String(modelId || "").trim() || this.defaultModelId();
    getDb()
      .prepare(`UPDATE billing_accounts SET model_id = ?, updated_at = ? WHERE user_id = ?`)
      .run(id, new Date().toISOString(), userId);
    this.logEvent(userId, "model_select", { modelId: id }, null);
  }

  /**
   * Charge tokens for one LLM round-trip. Packs are drained before base
   * quota. Returns the resulting remaining balance and whether the charge was
   * allowed (caller pre-checks, but a lapsed subscription here blocks too).
   */
  charge(
    userId: number,
    promptTokens: number,
    completionTokens: number,
    multiplier: number
  ): ChargeResult {
    const cost = Math.max(1, Math.round((promptTokens + completionTokens) * multiplier));
    return getDb().transaction(() => {
      const acc = this.getAccount(userId);
      if (!this.hasActiveSub(acc)) {
        return { ok: false, cost, remaining: 0, reason: "no_subscription" } as ChargeResult;
      }
      const remaining = this.effectiveRemaining(acc);
      if (cost > remaining) {
        return { ok: false, cost, remaining, reason: "no_quota" } as ChargeResult;
      }

      const fromPacks = Math.min(acc.packsTokens, cost);
      const rest = cost - fromPacks;
      getDb()
        .prepare(
          `UPDATE billing_accounts SET packs_tokens = ?, base_used_tokens = ?,
             total_used_tokens = total_used_tokens + ?, updated_at = ? WHERE user_id = ?`
        )
        .run(
          acc.packsTokens - fromPacks,
          acc.baseUsedTokens + rest,
          cost,
          new Date().toISOString(),
          userId
        );
      this.logEvent(
        userId,
        "token_spend",
        { promptTokens, completionTokens, multiplier, fromPacks, rest },
        cost
      );
      return { ok: true, cost, remaining: remaining - cost };
    })();
  }

  /** Record a successful Stars subscription payment (first or recurring). */
  recordSubscriptionPayment(userId: number, payment: PaymentInfo): BillingAccount {
    this.ensureAccount(userId);
    const expiresAt =
      payment.subscription_expiration_date ??
      Math.floor(Date.now() / 1000) + this.config.periodSeconds;
    const isFirst = payment.is_first_recurring === true || !payment.is_recurring;
    const type = isFirst ? "subscription_start" : "subscription_renew";

    getDb()
      .prepare(
        `UPDATE billing_accounts SET
           sub_status = 'active',
           sub_expires_at = ?,
           sub_period_start = ?,
           base_used_tokens = 0,
           last_charge_id = ?,
           updated_at = ?
         WHERE user_id = ?`
      )
      .run(
        expiresAt,
        Math.floor(Date.now() / 1000),
        payment.telegram_payment_charge_id,
        new Date().toISOString(),
        userId
      );

    this.logEvent(
      userId,
      type,
      {
        chargeId: payment.telegram_payment_charge_id,
        stars: payment.total_amount,
        expiresAt,
        recurring: !!payment.is_recurring,
      },
      payment.total_amount
    );
    return this.readRaw(userId) as BillingAccount;
  }

  recordPackPurchase(userId: number, pack: PackLike): BillingAccount {
    this.ensureAccount(userId);
    getDb()
      .prepare(
        `UPDATE billing_accounts SET packs_tokens = packs_tokens + ?, updated_at = ?
         WHERE user_id = ?`
      )
      .run(pack.tokens, new Date().toISOString(), userId);
    this.logEvent(
      userId,
      "pack_purchase",
      { packId: pack.id, packName: pack.name, tokens: pack.tokens },
      pack.tokens
    );
    return this.readRaw(userId) as BillingAccount;
  }

  markCancelled(userId: number): void {
    getDb()
      .prepare(
        `UPDATE billing_accounts SET sub_status = 'cancelled', updated_at = ?
         WHERE user_id = ?`
      )
      .run(new Date().toISOString(), userId);
    this.logEvent(userId, "subscription_cancel", {}, null);
  }

  listEvents(userId: number, limit = 50): BillingEvent[] {
    const rows = getDb()
      .prepare<
        [number, number],
        {
          id: number;
          user_id: number;
          type: string;
          payload: string | null;
          amount: number | null;
          created_at: string;
        }
      >(
        `SELECT id, user_id, type, payload, amount, created_at
         FROM billing_events WHERE user_id = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(userId, limit);
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      payload: r.payload ? JSON.parse(r.payload) : null,
      amount: r.amount,
      createdAt: r.created_at,
    }));
  }

  private logEvent(userId: number, type: string, payload: unknown, amount: number | null): void {
    getDb()
      .prepare(
        `INSERT INTO billing_events (user_id, type, payload, amount, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        type,
        payload != null ? JSON.stringify(payload) : null,
        amount,
        new Date().toISOString()
      );
  }
}
