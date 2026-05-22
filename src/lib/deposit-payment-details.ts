/** Bank / EFT details and POP contact shown on the Cashier → Deposits tab. Set in `.env`. */
export type DepositPaymentDetails = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchCode: string | null;
  /** Shown as payment reference hint, e.g. your username. */
  paymentReferenceHint: string | null;
  popEmail: string | null;
  popPhone: string | null;
  /** True when account fields and at least one POP contact are set. */
  configured: boolean;
};

function trimOrNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function getDepositPaymentDetails(): DepositPaymentDetails {
  const bankName = process.env.DEPOSIT_BANK_NAME?.trim() ?? "";
  const accountName = process.env.DEPOSIT_ACCOUNT_NAME?.trim() ?? "";
  const accountNumber = process.env.DEPOSIT_ACCOUNT_NUMBER?.trim() ?? "";
  const branchCode = trimOrNull(process.env.DEPOSIT_BRANCH_CODE);
  const paymentReferenceHint = trimOrNull(process.env.DEPOSIT_PAYMENT_REFERENCE_HINT);
  const popEmail = trimOrNull(process.env.DEPOSIT_POP_EMAIL);
  const popPhone = trimOrNull(process.env.DEPOSIT_POP_PHONE);

  const configured =
    bankName.length > 0 &&
    accountName.length > 0 &&
    accountNumber.length > 0 &&
    (popEmail !== null || popPhone !== null);

  return {
    bankName,
    accountName,
    accountNumber,
    branchCode,
    paymentReferenceHint,
    popEmail,
    popPhone,
    configured,
  };
}
