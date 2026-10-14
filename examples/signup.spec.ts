// Example Playwright test (TypeScript): create an inbox, sign up in the app under test, read the OTP.
//
//   MAILBOX_URL=http://localhost:8000 APP_URL=https://staging.example.com npx playwright test examples/signup.spec.ts
//
// For CI, prefer a mailbox-bound API key (scoped, revocable) over the mailbox token — see docs/QA_AUTOMATION.md.
import { test, expect, request } from "@playwright/test";

const MAILBOX_URL = process.env.MAILBOX_URL ?? "http://localhost:8000";

test("sign-up sends a verification code", async ({ page }) => {
  const api = await request.newContext({ baseURL: MAILBOX_URL });

  // 1. A fresh address for this test
  const created = await api.post("/api/mailboxes", { data: { label: "playwright signup" } });
  expect(created.status()).toBe(201);
  const { mailbox, token } = await created.json();
  const auth = { "X-Mailbox-Token": token };
  const since = new Date().toISOString();

  // 2. Drive the application under test
  await page.goto(process.env.APP_URL ?? "https://staging.example.com/signup");
  await page.getByLabel("Email").fill(mailbox.address);
  await page.getByRole("button", { name: "Sign up" }).click();

  // 3. Long-poll until the email arrives (408 = nothing matched in time)
  const waited = await api.get(`/api/mailboxes/${mailbox.id}/wait`, {
    headers: auth,
    params: { subject: "verify", since, timeout: "90" },
    timeout: 100_000,
  });
  expect(waited.status(), await waited.text()).toBe(200);
  const message = await waited.json();
  const code: string = message.otp_codes[0].code;

  // 4. Finish the flow with the code
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();

  // 5. Clean up
  await api.delete(`/api/mailboxes/${mailbox.id}`, { headers: auth });
});
