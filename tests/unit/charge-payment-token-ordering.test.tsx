/**
 * The card charge must tokenize BEFORE the confirm screen replaces the form.
 *
 * `ChargePaymentDialog` renders the confirm step as an early return into a different tree:
 *
 *     if (showConfirm) return <Dialog>…</Dialog>
 *
 * so showing it UNMOUNTS the hosted-field containers. AffiniPay's SDK goes on holding those
 * iframes, and a detached iframe has a null `contentWindow` — so asking it for a token from the
 * confirm step posts to nothing and throws:
 *
 *     Cannot read properties of null (reading 'postMessage')
 *
 * That is the bug this file exists to prevent recurring. It has now been shipped twice before
 * (#156, #185) against the wrong hypothesis, both times with no test, and both times it came
 * back. What is asserted here is the ordering invariant itself — `getPaymentToken` is called
 * while the fields are on screen, and never once the confirm step is showing — because that is
 * the property that makes the crash impossible, independently of anything the SDK does.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const originalAppendChild = document.head.appendChild;
let appendSpy: ReturnType<typeof vi.spyOn> | undefined;

const installSdk = () => {
  (window as unknown as { AffiniPay: unknown }).AffiniPay = { HostedFields: { initializeFields } };
};

/** Records when the SDK is asked for a token, relative to what is on screen. */
const getPaymentToken = vi.fn(async () => ({ id: 'tok_live_123' }));
const getState = vi.fn(() => ({ fields: [] }));
/**
 * The real SDK reports readiness through the state callback, and the dialog gates its Review
 * button on that (`state.isReady || anyFieldMounted`). Invoke it the way the SDK does, or the
 * button stays disabled and nothing under test ever runs.
 */
const initializeFields = vi.fn(
  (_config: unknown, onState?: (s: { isReady: boolean; fields: unknown[] }) => void) => {
    onState?.({ isReady: true, fields: [{ type: 'credit_card_number', error: null }] });
    return { getPaymentToken, getState };
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  // Stand in for the SDK the loader would otherwise fetch.
  //
  // Defined NON-CONFIGURABLE on purpose: the component calls `resetHostedFieldsSdk()` on every
  // open, which does `delete window.AffiniPay` and re-adds the <script> tag. jsdom cannot load
  // that script, so a deletable mock would leave the SDK permanently absent and the dialog would
  // never initialize. Making the delete fail keeps the loader's `if (window.AffiniPay?.HostedFields)
  // return` fast path, which is what a warm cache does in a browser.
  installSdk();

  // The component deletes the global and re-adds the <script> tag on every open
  // (`resetHostedFieldsSdk`). jsdom will never fetch that script, so stand in for the browser:
  // when the tag is appended, put the global back and fire onload — exactly what a real (cached)
  // load does. Faithful to the real sequence rather than bypassing it.
  appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
    const el = node as HTMLScriptElement;
    if (el.tagName === 'SCRIPT' && el.src?.includes('hostedfields')) {
      installSdk();
      queueMicrotask(() => el.onload?.(new Event('load')));
      return node;
    }
    return originalAppendChild.call(document.head, node) as Node;
  }) as typeof document.head.appendChild);
});

afterEach(() => {
  appendSpy?.mockRestore();
  vi.clearAllMocks();
});

/** The Labels carry no htmlFor, so fields are reached by their ids. */
async function fillForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const byId = (id: string) => {
    const el = document.querySelector(`#${id}`);
    if (!el) throw new Error(`missing #${id}`);
    return el as HTMLElement;
  };
  await user.type(byId('charge-description'), 'Consultation');
  await user.type(byId('charge-amount'), '100.00');
  await user.type(byId('af-exp-month'), '04');
  await user.type(byId('af-exp-year'), '2029');
  await user.type(byId('af-billing-zip'), '08831');
}

async function renderDialog() {
  const { ChargePaymentDialog } = await import('@/components/payments/ChargePaymentDialog');
  return render(
    <MemoryRouter><ChargePaymentDialog
      open
      onClose={() => {}}
      firmId="firm-1"
      lawPayPublicKey="m_xTESTKEY0123456789012"
      clientId="client-1"
      clientEmail="client@example.com"
      clientName="Test Client"
    /></MemoryRouter>,
  );
}

describe('the charge dialog tokenizes before it unmounts the fields', () => {
  test('getPaymentToken is called at Review — while the hosted fields are still mounted', async () => {
    const user = userEvent.setup();
    await renderDialog();

    // The SDK mounts its iframes into these; they exist only while the form tree is rendered.
    await waitFor(() => expect(document.querySelector('#af-card-number')).not.toBeNull(), {
      timeout: 3000,
    });

    await fillForm(user);

    expect(getPaymentToken).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /review charge/i }));

    // Tokenized on the way to confirm, not from it.
    await waitFor(() => expect(getPaymentToken).toHaveBeenCalledTimes(1));

    // And by the time the confirm screen is up, the containers are gone — which is precisely
    // why the token had to be taken first.
    // And by the time the confirm screen is up the containers are gone — which is precisely why
    // the token had to be taken first.
    await waitFor(() => expect(screen.getByText(/confirm payment/i)).toBeInTheDocument());
    expect(document.querySelector('#af-card-number')).toBeNull();
  });

  test('confirming does NOT go back to the SDK', async () => {
    const user = userEvent.setup();
    await renderDialog();
    await waitFor(() => expect(document.querySelector('#af-card-number')).not.toBeNull(), {
      timeout: 3000,
    });

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /review charge/i }));

    await waitFor(() => expect(screen.getByText(/confirm payment/i)).toBeInTheDocument());
    const callsBeforeConfirm = getPaymentToken.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /charge|confirm/i }));

    // The invariant. Any call from here reaches a detached iframe and throws the postMessage
    // error — so the count must not move.
    await waitFor(() => {
      expect(getPaymentToken.mock.calls.length).toBe(callsBeforeConfirm);
    });
  });
});
