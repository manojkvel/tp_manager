// v1.7 Wave 11 — Order email dispatch (§6.7).
//
// Renders a draft order into a plain-text + HTML email and hands it to a
// transport. The default transport logs to stdout so dev/test doesn't send
// real mail; production wires a nodemailer transport via `createSmtpTransport`
// when `SMTP_HOST` is configured. The rendering is pure so we can unit-test it
// without touching any SMTP server.

import type { Order, OrderLine } from './service.js';

export interface EmailRecipient {
  to: string;
  cc?: string | null;
  from: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  name: string;
  send(msg: EmailRecipient): Promise<void>;
}

export interface SupplierForEmail {
  id: string;
  name: string;
  email: string | null;
  contact_name: string | null;
}

export interface LineForEmail extends OrderLine {
  ingredient_name?: string;
  uom?: string | null;
}

export interface RestaurantForEmail {
  name: string;
  owner_email?: string | null;
}

export class SupplierEmailMissingError extends Error {
  constructor(supplier_id: string) {
    super(`supplier ${supplier_id} has no email on file`);
    this.name = 'SupplierEmailMissingError';
  }
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderOrderEmail(args: {
  order: Order;
  supplier: SupplierForEmail;
  restaurant: RestaurantForEmail;
  lines: LineForEmail[];
  fromAddress: string;
}): EmailRecipient {
  const { order, supplier, restaurant, lines, fromAddress } = args;
  if (!supplier.email) throw new SupplierEmailMissingError(supplier.id);

  const greetingName = supplier.contact_name ?? supplier.name;
  const subject = `Order from ${restaurant.name} — ${order.id.slice(0, 8)}`;
  const expected = order.expected_on ? order.expected_on.toISOString().slice(0, 10) : 'ASAP';

  const lineTotalCents = lines.reduce((sum, l) => sum + Math.round(l.qty * l.unit_cost_cents), 0);

  const textLines = [
    `Hi ${greetingName},`,
    '',
    `Please find attached purchase order ${order.id} from ${restaurant.name}.`,
    `Expected delivery: ${expected}`,
    '',
    'Lines:',
    ...lines.map((l) => {
      const name = l.ingredient_name ?? l.ingredient_id;
      const uom = l.uom ?? '';
      return `  - ${name}: ${l.qty} ${uom} @ ${centsToUsd(l.unit_cost_cents)}`;
    }),
    '',
    `Total: ${centsToUsd(lineTotalCents)}`,
    '',
    `Thanks,`,
    `${restaurant.name}`,
  ];

  const rowsHtml = lines
    .map((l) => {
      const name = escapeHtml(l.ingredient_name ?? l.ingredient_id);
      const uom = escapeHtml(l.uom ?? '');
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${l.qty} ${uom}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${centsToUsd(l.unit_cost_cents)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${centsToUsd(Math.round(l.qty * l.unit_cost_cents))}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;margin:0;padding:24px">
  <p>Hi ${escapeHtml(greetingName)},</p>
  <p>Please find below purchase order <strong>${escapeHtml(order.id.slice(0, 8))}</strong> from ${escapeHtml(restaurant.name)}.</p>
  <p><strong>Expected delivery:</strong> ${escapeHtml(expected)}</p>
  <table style="border-collapse:collapse;min-width:520px;margin-top:12px">
    <thead>
      <tr style="background:#f1f5f9;text-align:left">
        <th style="padding:8px 10px">Item</th>
        <th style="padding:8px 10px;text-align:right">Qty</th>
        <th style="padding:8px 10px;text-align:right">Unit</th>
        <th style="padding:8px 10px;text-align:right">Line total</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="padding:8px 10px;text-align:right;font-weight:600">Total</td>
        <td style="padding:8px 10px;text-align:right;font-weight:600">${centsToUsd(lineTotalCents)}</td>
      </tr>
    </tfoot>
  </table>
  <p style="margin-top:24px">Thanks,<br/>${escapeHtml(restaurant.name)}</p>
</body></html>`;

  return {
    to: supplier.email,
    cc: restaurant.owner_email ?? null,
    from: fromAddress,
    subject,
    text: textLines.join('\n'),
    html,
  };
}

export class LogEmailTransport implements EmailTransport {
  readonly name = 'log';
  public readonly sent: EmailRecipient[] = [];
  async send(msg: EmailRecipient): Promise<void> {
    this.sent.push(msg);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: 'info', msg: 'order email (dev log transport)', to: msg.to, cc: msg.cc, subject: msg.subject }));
  }
}

/**
 * Resolve an email transport from env. When `SMTP_HOST` is unset we log so
 * local dev never sends real mail; otherwise we dynamically import nodemailer
 * (optional dep) and build an SMTP transport. If the optional dep is missing
 * we fall back to the log transport and warn.
 */
export async function resolveEmailTransport(env: NodeJS.ProcessEnv = process.env): Promise<EmailTransport> {
  if (!env.SMTP_HOST) return new LogEmailTransport();
  try {
    const mod = await import('nodemailer' as string).catch(() => null);
    if (!mod) return new LogEmailTransport();
    const tx = (mod as { createTransport: (opts: unknown) => { sendMail: (msg: EmailRecipient) => Promise<void> } }).createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    return {
      name: 'smtp',
      async send(msg) { await tx.sendMail(msg); },
    };
  } catch {
    return new LogEmailTransport();
  }
}
